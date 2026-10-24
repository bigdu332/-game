import assert from 'node:assert/strict';
import {MarketGame} from './dist/engine.js';
const close=(a,b,label)=>assert(Math.abs(a-b)<1e-6,`${label}: ${a} != ${b}`);
const clean=(seed=1,leverage=5)=>{const g=new MarketGame(seed);g.orders=[];g.setLeverage(leverage);return g;};
const open=(g,qty,price=100)=>g.recordFill(g.human,qty,price);
const treasury=g=>g.players.reduce((sum,p)=>sum+p.cash,0);

// Everyone starts flat with equal, uncommitted capital.
const initial=new MarketGame(1);
for(const p of initial.players.slice(0,4)){assert.equal(p.shares,0);close(p.cash,20000,'initial wallet');close(initial.marginState(p).available,20000,'initial available');assert.equal(p.autoTopUp,false);}

// All-in budgets work symmetrically at all shortcut leverages, for both order types.
for(const leverage of [1,5,10,20])for(const side of ['buy','sell'])for(const type of ['market','limit']){
 const g=clean(2,leverage),available=g.marginState(g.human).available;
 assert(g.submitMargin(side,available,type,100).ok);
 const order=g.orders[0];assert.equal(order.qty,200*leverage);close(order.marginRemaining,20000,'all-in reservation');
 close(g.marginState(g.human).available,0,'no duplicate collateral');assert(!g.submitMargin(side,1,type,100).ok);
 g.cancel();close(g.marginState(g.human).available,20000,'cancellation releases all');
}

// Slippage spends only the locked budget; the fill can be smaller than the quoted quantity.
const slipped=clean(3,20);slipped.account('maker').shares=10000;
assert(slipped.submitMargin('buy',20000).ok);const slipOrder=slipped.orders[0];
slipped.addOrder('maker','sell',10000,'limit',105);slipped.match();
assert.equal(slipped.human.shares,3809);assert.equal(slipOrder.qty,191);
close(slipped.human.positionMargin,3809*105/20,'actual opening allocation');
assert(slipped.marginState(slipped.human).deficit<1e-6);
slipped.botOrders=()=>{};slipped.makeQuotes=()=>{};slipped.step();
assert(slipped.orders.some(o=>o.id===slipOrder.id),'budget-limited market remainder must persist');
close(slipped.marginState(slipped.human).reserved,2.75,'unspent market budget remains frozen');
close(slipped.marginState(slipped.human).available,0,'unused reservation cannot finance a second order');
slipped.cancel(slipOrder.id);close(slipped.marginState(slipped.human).available,2.75,'manual cancellation releases remainder');

// Regression: submit 200, fill 100, keep the SAME remaining 100 across empty rounds, then finish.
for(const side of ['buy','sell']){
 const g=clean(31);g.botOrders=()=>{};g.makeQuotes=()=>{};
 assert(g.submitMargin(side,4000).ok);const order=g.orders[0],id=order.id,created=order.created;
 assert.equal(order.initialQty,200);assert.equal(order.expires,null);
 g.addOrder('maker',side==='buy'?'sell':'buy',100,'limit',100);g.step();
 assert.equal(order.qty,100);assert.equal(g.human.shares,side==='buy'?100:-100);
 close(order.marginRemaining,2000,'partial market budget');close(g.marginState(g.human).reserved,2000,'partial market reservation');
 assert(g.events.some(e=>e.title==='委托回执'&&e.text.includes('余下 100 股')&&e.text.includes('继续保留')));
 g.setLeverage(20);
 for(let i=0;i<10;i++)g.step();
 assert.equal(g.orders.find(o=>o.id===id),order);assert.equal(order.qty,100);assert.equal(order.created,created);assert.equal(order.leverage,5);
 close(order.marginRemaining,2000,'no-fill rounds preserve budget');
 g.addOrder('maker',side==='buy'?'sell':'buy',100,'limit',100);g.step();
 assert(!g.orders.some(o=>o.id===id));assert.equal(g.human.shares,side==='buy'?200:-200);
 close(g.human.positionMargin,4000,'continuation uses original order leverage');close(g.marginState(g.human).reserved,0,'completed market budget released');
 const quantity=g.trades.filter(t=>t.bidId===id||t.askId===id).reduce((sum,t)=>sum+t.qty,0);assert.equal(quantity,200,'never re-submit original full quantity');
}

// Persistent market orders use the next round's prices, without spending beyond the original budget.
const repriced=clean(32);repriced.botOrders=()=>{};repriced.makeQuotes=()=>{};
repriced.submitMargin('buy',4000);const carried=repriced.orders[0];
repriced.addOrder('maker','sell',100,'limit',100);repriced.step();
repriced.price=120;repriced.addOrder('maker','sell',100,'limit',120);repriced.step();
assert.equal(repriced.human.shares,183,'continues outside old 112 guard at next-round price');assert.equal(carried.qty,17);
close(carried.marginRemaining,8,'higher price consumes only original budget');close(repriced.marginState(repriced.human).reserved,8,'remaining budget still locked');
repriced.step();assert(repriced.orders.some(o=>o.id===carried.id),'insufficient budget does not cancel remainder');
const preserved=repriced.marginState(repriced.human).available;repriced.cancel(carried.id);close(repriced.marginState(repriced.human).available,preserved+8,'manual cancellation releases frozen funds');

// A partial close also continues across rounds, with no new margin and no reversal.
const closeLater=clean(33);closeLater.botOrders=()=>{};closeLater.makeQuotes=()=>{};open(closeLater,200);
assert(closeLater.flatten().ok);const closing=closeLater.orders[0];
closeLater.addOrder('maker','buy',100,'limit',100);closeLater.step();assert.equal(closing.qty,100);assert.equal(closeLater.human.shares,100);
closeLater.step();assert(closeLater.orders.some(o=>o.id===closing.id));
closeLater.addOrder('maker','buy',200,'limit',100);closeLater.step();assert.equal(closeLater.human.shares,0);assert(!closeLater.orders.some(o=>o.id===closing.id));

// A resting GTC survives thirty rounds, preserving its budget and creation round.
const gtc=new MarketGame(4);assert(gtc.submitMargin('buy',1000,'limit',10).ok);
const resting=gtc.orders.find(o=>o.owner==='you'),created=resting.created;
for(let i=0;i<30;i++){gtc.step();assert(gtc.orders.some(o=>o.id===resting.id),'GTC must not expire');}
assert.equal(resting.expires,null);assert.equal(resting.created,created);close(resting.marginRemaining,1000,'resting budget stable');
gtc.cancel(resting.id);close(gtc.marginState(gtc.human).reserved,0,'GTC cancellation releases budget');

const partial=clean(5);partial.submitMargin('buy',1800,'limit',90);
const part=partial.orders[0];partial.addOrder('pine','sell',30,'limit',90);partial.match();
assert.equal(part.qty,70);close(part.marginRemaining,1260,'partial budget');close(partial.human.positionMargin,540,'partial position margin');
partial.botOrders=()=>{};partial.makeQuotes=()=>{};
for(let i=0;i<12;i++)partial.step();assert.equal(partial.orders.find(o=>o.id===part.id).qty,70);

// Slider changes affect only new orders, never an old order's leverage or an existing position.
const locked=clean(6,20);open(locked,200);const originalMargin=locked.human.positionMargin;
locked.submitMargin('buy',1000,'limit',90);const old=locked.orders[0];
assert(locked.setLeverage(5).ok);close(locked.human.positionMargin,originalMargin,'existing margin unchanged');assert.equal(old.leverage,20);assert.equal(old.qty,222);
for(const leverage of [1,5,10,20])assert.equal(locked.quantityForMargin(1000,'limit',100,leverage),10*leverage);
assert(locked.setLeverage(13).ok);assert(!locked.setLeverage(21).ok);assert(!locked.setLeverage(1.5).ok);
assert(!locked.submitMargin('buy',0).ok);assert(!locked.submitMargin('buy',Infinity).ok);

// Shorts have the same finite margin budget as longs and no arbitrary 350-share cap.
for(const leverage of [1,5,10,20]){
 const g=clean(7,leverage);assert.equal(g.capacity(g.human,1,10000,100,100),200*leverage);assert.equal(g.capacity(g.human,-1,10000,100,100),200*leverage);
}
const short=clean(8);open(short,-1000);assert.equal(short.human.shares,-1000);close(short.human.cash,120000,'short proceeds ledger');
close(short.equity(short.human),20000,'short account equity');close(short.marginState(short.human).available,0,'proceeds cannot refinance');
assert.equal(short.capacity(short.human,-1,1,100,100),0);
const pump=clean(9);open(pump,1000);pump.price=200;
close(pump.equity(pump.human),120000,'floating account profit');close(pump.marginState(pump.human).available,0,'floating gain not reusable');
assert.equal(pump.capacity(pump.human,1,1,200,200),0);

// A 20x position liquidates independently from the idle wallet.
const isolated=clean(10,20);open(isolated,200);close(isolated.human.positionMargin,1000,'20x allocation');
close(isolated.marginState(isolated.human).available,19000,'idle wallet');
const line=isolated.liquidationPrice(isolated.human);assert(line>97&&line<98);assert(!isolated.checkMargin());
isolated.price=97;assert(isolated.checkMargin());assert(isolated.human.liquidating);assert.equal(isolated.human.forced,1);
close(isolated.marginState(isolated.human).available,19000,'default idle wallet untouched');
assert(!isolated.submitMargin('buy',1000).ok,'cannot open during liquidation');isolated.checkMargin();assert.equal(isolated.human.forced,1,'one liquidation episode counted once');
isolated.account('maker').cash=100000;isolated.addOrder('maker','buy',200,'limit',97);isolated.match();
assert.equal(isolated.human.shares,0);assert(!isolated.human.liquidating);close(isolated.human.cash,19400,'actual loss on liquidation');
const shortRisk=clean(11,20);open(shortRisk,-200);shortRisk.price=shortRisk.liquidationPrice(shortRisk.human)+.01;assert(shortRisk.checkMargin());

// Manual top-ups change collateral and the liquidation line, without changing quantity or account equity.
const topped=clean(12,20);open(topped,200);const eq=topped.equity(topped.human),oldLine=topped.liquidationPrice(topped.human);
assert(topped.addMargin(500).ok);assert.equal(topped.human.shares,200);close(topped.equity(topped.human),eq,'top-up is an internal transfer');
close(topped.marginState(topped.human).available,18500,'top-up uses idle balance');assert(topped.liquidationPrice(topped.human)<oldLine);
assert(!topped.addMargin(18501).ok);
const rescue=clean(13,20);open(rescue,200);rescue.human.autoTopUp=true;rescue.price=97;
assert(!rescue.checkMargin());close(rescue.margin(rescue.human),.1,'auto rescue target');close(rescue.human.positionMargin,2540,'automatic top-up');
const empty=clean(14,20);open(empty,4000);empty.human.autoTopUp=true;empty.price=97;assert(empty.checkMargin(),'no idle cash means rescue cannot prevent liquidation');

// Gap losses debit the real account, including idle balance; a surviving forced close is NOT a knockout.
const gap=clean(15,20);open(gap,200);gap.price=80;gap.checkMargin();
const before=treasury(gap),walletBefore=gap.human.cash;
for(let i=0;i<3;i++)gap.capacity(gap.human,-1,200,80,80,gap.orders[0].id,true);
close(gap.human.cash,walletBefore,'capacity probes have no side effects');
gap.addOrder('maker','buy',200,'limit',80);gap.match();
assert.equal(gap.human.shares,0);close(gap.human.cash,16000,'all of the gap loss debits the account');
close(gap.human.realized,-4000,'no fictional insurance credit');close(treasury(gap),before,'trade cash conserves');
assert(!gap.human.ruined);assert.equal(gap.knockouts.length,0);assert(gap.submitMargin('buy',100).ok,'forced liquidation survivor can re-enter');

// Cash spent on stock, an exhausted buying budget, and 10% remaining capital never imply bankruptcy.
const cashless=clean(34,1);open(cashless,200);assert.equal(cashless.human.cash,0);cashless.checkMargin();assert(!cashless.human.ruined);
const tenPercent=clean(35);tenPercent.human.cash=2000;tenPercent.human.realized=-18000;tenPercent.checkMargin();assert(!tenPercent.human.ruined);

// At equity <= 0, stop all ordinary trading immediately but allow the system to complete the close.
const insolvent=clean(36,20);open(insolvent,4000);insolvent.price=94;insolvent.checkMargin();
assert(insolvent.human.ruined&&insolvent.human.liquidating);assert.equal(insolvent.knockouts.length,1);assert.equal(insolvent.knockouts[0].equity,-4000);
assert(!insolvent.setLeverage(1).ok);assert(!insolvent.submitMargin('buy',1).ok);assert(!insolvent.flatten().ok);assert(!insolvent.reducePosition(.5).ok);assert(!insolvent.addMargin(1).ok);
const forcedId=insolvent.orders.find(o=>o.forced).id;assert.equal(insolvent.capacity(insolvent.human,-1,4000,94,94,forcedId,true),4000);
insolvent.addOrder('maker','buy',4000,'limit',94);insolvent.match();assert.equal(insolvent.human.shares,0);close(insolvent.human.cash,-4000,'negative debt is not forgiven');
assert(insolvent.human.ruined);insolvent.checkMargin();assert.equal(insolvent.knockouts.length,1,'bankruptcy is emitted only once');

// Actual price-moving trades attribute a knockout, symmetrically for squeezing shorts and dumping longs.
for(const direction of ['buy','sell']){
 const g=clean(37),victim=g.account(direction==='buy'?'wind':'fox'),maker=g.account('maker');
 const qty=direction==='buy'?-2000:2000;g.recordFill(victim,qty,100);g.recordFill(maker,-qty,100);
 const total=treasury(g),target=direction==='buy'?110:90;
 assert(g.submitMargin(direction,1000).ok);g.addOrder('maker',direction==='buy'?'sell':'buy',1,'limit',target);g.match();
 assert(victim.ruined);assert.equal(g.knockouts.length,1);assert.equal(g.knockouts[0].attacker,'you');assert.equal(victim.defeatedBy,'you');assert.equal(g.human.kills,1);close(g.knockouts[0].equity,0,'exact zero eliminates');close(treasury(g),total,'attack transfers cash rather than creating it');
 assert(!g.orders.some(o=>o.owner===victim.id&&!o.forced),'ordinary victim orders are cancelled');
 g.price=100;g.checkMargin();assert(victim.ruined,'a later rebound cannot revive a retired seat');assert.equal(g.knockouts.length,1);
 g.botOrders();assert(!g.orders.some(o=>o.owner===victim.id&&!o.forced),'retired bot cannot submit fresh intents');
}

// No false credit for pre-existing insolvency or forced-liquidation cascades.
const unrelated=clean(38);unrelated.account('pine').cash=0;unrelated.checkMargin();assert.equal(unrelated.knockouts[0].attacker,null);assert.equal(unrelated.human.kills,0);
const cascade=clean(39);const cv=cascade.account('pine');cascade.recordFill(cv,2000,100);cascade.price=90;
cascade.checkBankruptcies({aggressor:'you',price:90,previousPrice:100,forced:true,equityBefore:{pine:20000}});assert(cv.ruined);assert.equal(cascade.knockouts[0].attacker,null);

// Larger leveraged orders walk further through the SAME finite depth, in either direction.
const impacts={};
for(const direction of ['buy','sell']){
 const changes=[];
 for(const leverage of [1,20]){
  const g=new MarketGame(40);g.setLeverage(leverage);g.botOrders=()=>{};
  assert(g.submitMargin(direction,2000).ok);g.step();changes.push(Math.abs(g.price-100));
  assert(g.account('maker').cash>=0&&g.account('maker').shares>=0,'pool inventory and cash remain finite');
 }
 assert(changes[1]>changes[0]+4,'high leverage with the same own budget has materially greater market impact');impacts[direction]=changes;
}

// Only bankruptcy ends a seat; final survivor wins early, and simultaneous bankruptcies produce no winner.
const last=clean(41);for(const p of last.players.slice(1,4)){p.cash=0;p.realized=-20000;}last.step();
assert(last.done);assert.equal(last.winnerId,'you');assert.equal(last.endReason,'last-standing');
const none=clean(42);for(const p of none.players.slice(0,4)){p.cash=0;p.realized=-20000;}none.step();assert(none.done);assert.equal(none.winnerId,null);

// Cost basis, proportional release, reversal and reduce-only handling.
const ledger=clean(16);const p=ledger.human;open(ledger,100,100);open(ledger,100,120);
close(p.averageCost,110,'average cost');close(p.positionMargin,4400,'combined margin');
open(ledger,-50,130);close(p.realized,1000,'partial realization');close(p.positionMargin,3300,'proportional release');
open(ledger,-200,100);assert.equal(p.shares,-50);close(p.averageCost,100,'reverse cost');close(p.realized,-500,'reverse realization');close(p.positionMargin,1000,'only new short margin');
open(ledger,50,90);assert.equal(p.shares,0);close(p.realized,0,'final realized P&L');close(p.cash,20000,'final wallet');
const reduce=clean(17);open(reduce,1000);assert(reduce.reducePosition(.25).ok);const reduceOrder=reduce.orders[0];assert.equal(reduceOrder.qty,250);assert.equal(reduceOrder.marginRemaining,0);assert(reduceOrder.reduceOnly);
assert.equal(reduce.capacity(reduce.human,-1,2000,100,100,reduceOrder.id,true),1000);assert.equal(reduce.capacity(reduce.human,1,100,100,100,reduceOrder.id,true),0);

// Public clues depend on completed rounds, not current orders or settings.
const delayed=new MarketGame(18);assert.equal(delayed.intel,null);delayed.step();const snapshot=JSON.stringify(delayed.intel);
delayed.submitMargin('buy',1000);delayed.setLeverage(20);assert.equal(JSON.stringify(delayed.intel),snapshot);

// Complete seeded matches cover matching, top-ups, liquidation, cash/stock conservation and terminal payouts.
let forcedCount=0,accepted=0,lowest=Infinity,highest=0,knockouts=0,rounds=0;
for(let seed=1;seed<=160;seed++){
 const g=new MarketGame(seed);g.setLeverage([1,5,10,20][seed%4]);
 for(let round=0;round<48&&!g.done;round++){
  if(round%3===0){const budget=Math.floor(g.marginState(g.human).available*[.25,.5,1][seed%3]*100)/100;accepted+=Number(g.submitMargin(round%6===0?'buy':'sell',budget).ok);}
  if(round%11===0)g.submitMargin('buy',Math.min(100,g.marginState(g.human).available),'limit',10);
  if(round%17===0)g.cancel();
  if(round%7===0)g.human.autoTopUp=seed%2===0;
  if(round%13===0&&g.human.shares)g.addMargin(Math.min(100,g.marginState(g.human).available));
  if(round%19===0&&g.human.shares&&!g.human.liquidating)g.reducePosition(.25);
  g.step();rounds++;assert(Number.isFinite(g.price));assert.equal(g.round,round+1);
  if(!g.done){close(treasury(g),g.initialCash,'cash conservation');assert.equal(g.players.reduce((s,p)=>s+p.shares,0),g.initialShares,'stock conservation');}
  for(const p of g.players.slice(0,4)){
   assert(Number.isFinite(p.cash)&&Number.isInteger(p.shares));assert(p.positionMargin>=0);
   close(g.equity(p)-p.initialEquity,p.realized+g.unrealized(p),'P&L reconciliation');
   if(!p.liquidating&&!p.ruined)assert(g.marginState(p).deficit<1e-6,'ordinary accounts cannot overcommit collateral');
   if(p.ruined)assert(!g.orders.some(o=>o.owner===p.id&&!o.forced),'bankrupt accounts have no ordinary live orders');
  }
  assert.equal(g.intel.round,g.round);
  for(const info of g.intel.players){
   const net=g.trades.filter(t=>t.round===g.round).reduce((sum,t)=>sum+(t.buyer===info.id?t.qty:0)-(t.seller===info.id?t.qty:0),0);
   assert.equal(info.flow,Math.sign(net));assert(Math.abs(net)>=info.size[0]);assert(info.size[1]===null||Math.abs(net)<=info.size[1]);
   assert(!('cash' in info)&&!('shares' in info)&&!('averageCost' in info));
  }
 }
 assert(g.done&&g.orders.length===0);assert(g.players.every(p=>p.shares===0&&p.positionMargin===0));
 close(treasury(g),g.initialCash+g.initialShares*g.finalValue,'terminal payout with debt');
 forcedCount+=g.players.reduce((sum,p)=>sum+p.forced,0);knockouts+=g.knockouts.length;assert(g.knockouts.every(e=>e.equity<=0));assert.equal(new Set(g.knockouts.map(e=>e.victim)).size,g.knockouts.length);assert.equal(g.players.reduce((sum,p)=>sum+p.kills,0),g.knockouts.filter(e=>e.attacker).length);
 lowest=Math.min(lowest,...g.history.map(h=>h.price));highest=Math.max(highest,...g.history.map(h=>h.price));
 const n=g.round;g.step();assert.equal(g.round,n);
}
const a=new MarketGame(99),b=new MarketGame(99);for(let i=0;i<48;i++){a.step();b.step();}assert.deepEqual(a.summary(),b.summary());
console.log(JSON.stringify({status:'passed',matches:160,rounds,acceptedMarginOrders:accepted,forcedTriggers:forcedCount,bankruptcies:knockouts,impacts,priceRange:[lowest,highest],checks:['100% budget, long/short and 1/5/10/20x','persistent market remainder: 200 to 100 to complete, both directions','next-round repricing with fixed budget','partial close continuation','partial fills within locked budget','GTC longevity and budget release','isolated liquidation','manual and automatic rescue','full gap loss and debt accounting','forced-close survivor can trade again','zero equity bankruptcy only','knockout attribution without duplicate or false credit','larger order market impact','early victory and no-survivor ending','cost basis and reduce-only','delayed public clues','settlement reconciliation']}));
