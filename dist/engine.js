export class MarketGame {
  constructor(seed = Date.now()) { this.reset(seed); }
  reset(seed) {
    this.seed = Number(seed) >>> 0; this.rng = this.seed || 1;
    this.round = 0; this.totalRounds = 48; this.price = 100; this.lastPrice = 100;
    this.finalValue = Math.round(80 + this.random() * 40);
    this.forecast = [70,130]; this.done = false; this.seq = 0; this.orders = [];
    this.maintenance = .025; this.marketProtection = .2; this.knockouts = []; this.winnerId = null; this.endReason = null; this.intel = null; this.intelHistory = [];
    this.players = [
      {id:'you',name:'你',style:'自由交易',cash:20000,shares:0,leverage:5,color:'#b8f570'},
      {id:'fox',name:'红狐',style:'控盘型',cash:20000,shares:0,leverage:10,color:'#ffb36b'},
      {id:'wind',name:'追风',style:'趋势型',cash:20000,shares:0,leverage:20,color:'#a79bff'},
      {id:'pine',name:'冷杉',style:'价值型',cash:20000,shares:0,leverage:5,color:'#79c9e8'},
      {id:'maker',name:'流动性池',cash:400000,shares:4000,leverage:1,color:'#777'}
    ];
    this.players.forEach(p=>{p.trades=0;p.forced=0;p.peak=20000;p.drawdown=0;p.ruined=false;p.averageCost=p.shares?100:0;p.realized=0;p.initialEquity=p.cash+p.shares*100;p.positionMargin=0;p.autoTopUp=false;p.liquidating=false;p.outRound=null;p.defeatedBy=null;p.kills=0;});
    this.initialCash = this.players.reduce((s,p)=>s+p.cash,0);
    this.initialShares = this.players.reduce((s,p)=>s+p.shares,0);
    this.trades = []; this.history = [{round:0,price:100,volume:0,equity:20000}];
    this.events = []; this.lastVolume = 0; this.totalVolume = 0;
    this.news('开盘', '星海科技开始交易。最终兑付参考区间 ¥70–130，所有玩家拥有相同的公开信息。');
    this.makeQuotes();
  }
  random() { this.rng ^= this.rng << 13; this.rng ^= this.rng >>> 17; this.rng ^= this.rng << 5; return (this.rng>>>0)/4294967296; }
  get human() { return this.players[0]; }
  account(id) { return this.players.find(p=>p.id===id); }
  equity(p,price=this.price) { return p.cash+p.shares*price; }
  exposure(p) { return Math.abs(p.shares*this.price)/Math.max(1,this.equity(p)); }
  positionEquity(p,mark=this.price) { return p.positionMargin+this.unrealized(p,mark); }
  positionLeverage(p,mark=this.price) { return p.shares?Math.abs(p.shares*mark)/Math.max(.01,this.positionEquity(p,mark)):0; }
  margin(p,mark=this.price) { return p.shares ? this.positionEquity(p,mark)/Math.abs(p.shares*mark) : 1; }
  collateral(p) { return Math.max(0,p.initialEquity+p.realized); }
  marginState(p,mark=this.price,orders=this.orders) {
    const reserved=orders.filter(o=>o.owner===p.id&&!o.forced&&o.qty>0).reduce((s,o)=>s+Math.max(0,o.marginRemaining||0),0);
    const used=p.positionMargin,committed=used+reserved,eligible=this.collateral(p);
    return {eligible,used,reserved,committed,available:Math.max(0,eligible-committed),deficit:Math.max(0,committed-eligible)};
  }
  quantityForMargin(amount,type='market',price=null,leverage=this.human.leverage) {
    const reference=type==='limit'?Number(price):this.price;
    if(!Number.isFinite(Number(amount))||Number(amount)<=0||!Number.isFinite(reference)||reference<=0)return 0;
    return Math.floor((Number(amount)*leverage+.000001)/reference);
  }
  previewOrder(side,qty,type='market',price=null) {
    const reference=this.price;
    const limit=type==='market'?(side==='buy'?reference*(1+this.marketProtection):reference*(1-this.marketProtection)):Number(price);
    const candidate={id:-1,owner:'you',side,qty:Math.max(0,Math.floor(qty)),type,price:limit,reference,forced:false,reduceOnly:false,marginRemaining:Math.max(0,qty)*(type==='limit'?Number(price):reference)/this.human.leverage};
    const before=this.marginState(this.human),after=this.marginState(this.human,reference,[...this.orders,candidate]);
    return {additional:Math.max(0,after.committed-before.committed),availableAfter:after.available,deficit:after.deficit};
  }
  submitMargin(side,amount,type='market',price=null) {
    const available=this.marginState(this.human).available;
    if(!Number.isFinite(Number(amount))||amount<=0||amount>available+.0001)return {ok:false,message:`本笔投入不能超过当前可用余额 ¥${available.toFixed(2)}`};
    const qty=this.quantityForMargin(amount,type,price);
    if(qty<1)return {ok:false,message:'这笔保证金不足以换算 1 股，请提高金额或杠杆'};
    return this.submit(side,qty,type,price,Number(amount));
  }
  fundingPressure(p) {
    if(p.shares&&this.positionEquity(p)<=0)return '穿仓';
    if(p.shares&&this.margin(p)<=this.maintenance*2)return '临界';
    const leverage=this.positionLeverage(p);return leverage>=8?'高':leverage>=3?'中':'低';
  }
  unrealized(p,price=this.price) { return p.shares*(price-p.averageCost); }
  liquidationPrice(p) {
    if(p.shares>0)return Math.max(0,(p.shares*p.averageCost-p.positionMargin)/(p.shares*(1-this.maintenance)));
    if(p.shares<0)return (Math.abs(p.shares)*p.averageCost+p.positionMargin)/(Math.abs(p.shares)*(1+this.maintenance));
    return null;
  }
  recordFill(p,delta,price,allocated=null) {
    const before=p.shares,after=before+delta;
    const closed=before*delta<0?Math.min(Math.abs(before),Math.abs(delta)):0;
    const opened=Math.abs(delta)-closed;
    const released=closed?p.positionMargin*closed/Math.abs(before):0;
    const openingMargin=p.id==='maker'?0:allocated??opened*price/p.leverage;
    p.positionMargin=Math.max(0,p.positionMargin-released)+openingMargin;
    if(before===0||Math.sign(before)===Math.sign(delta)) {
      p.averageCost=(Math.abs(before)*p.averageCost+Math.abs(delta)*price)/Math.abs(after);
    } else {
      p.realized+=Math.min(Math.abs(before),Math.abs(delta))*(price-p.averageCost)*Math.sign(before);
      if(after===0)p.averageCost=0;
      else if(Math.sign(after)!==Math.sign(before))p.averageCost=price;
    }
    p.cash-=delta*price;p.shares=after;
    if(!after){p.positionMargin=0;p.liquidating=false;}
    return {opened,closed,allocated:openingMargin,released};
  }
  addMargin(amount,p=this.human,automatic=false) {
    if(this.done||p.ruined||!p.shares||p.liquidating)return {ok:false,message:'当前没有可补充保证金的仓位'};
    const available=this.marginState(p).available;
    if(!Number.isFinite(amount)||amount<=0||amount>available+.0001)return {ok:false,message:'可用余额不足，不能补充这笔保证金'};
    p.positionMargin+=amount;
    if(p.id==='you')this.news(automatic?'自动救仓':'补充保证金',`你追加了 ¥${amount.toFixed(2)}，强平价已更新。`);
    return {ok:true,message:`已追加 ¥${amount.toFixed(2)} 保证金`};
  }
  news(title,text,type='info') { this.events.unshift({round:this.round,title,text,type}); this.events=this.events.slice(0,80); }
  addOrder(owner,side,qty,type='market',price=null,forced=false,reduceOnly=false,budget=null) {
    const id=++this.seq;
    const limit=type==='market' ? (side==='buy'?this.price*(1+this.marketProtection):this.price*(1-this.marketProtection)) : Number(price);
    const p=this.account(owner),reference=type==='limit'?Number(price):this.price;
    const marginBudget=owner==='maker'||forced||reduceOnly?0:budget??Math.floor(qty)*reference/p.leverage;
    const order={id,owner,side,qty:Math.floor(qty),initialQty:Math.floor(qty),type,price:Math.round(limit*100)/100,reference:this.price,leverage:p.leverage,marginRemaining:marginBudget,marginBudget,created:this.round,expires:type==='limit'||(owner==='you'&&!forced)?null:this.round+1,forced,reduceOnly:reduceOnly||forced};
    this.orders.push(order); return order;
  }
  setLeverage(value) {
    if(this.done) return {ok:false,message:'本局已结算'};
    if(this.human.ruined)return {ok:false,message:'你已破产退赛，本局只能观战'};
    if(!Number.isInteger(Number(value))||value<1||value>20) return {ok:false,message:'杠杆请选择 1–20× 的整数'};
    this.human.leverage=Number(value);return {ok:true};
  }
  submit(side,qty,type='market',price=null,budget=null) {
    if(this.done||this.human.ruined) return {ok:false,message:'本局已停止交易'};
    if(this.human.liquidating)return {ok:false,message:'当前仓位正在强平，完成后可重新入场'};
    if(!['buy','sell'].includes(side)||!['market','limit'].includes(type)) return {ok:false,message:'无效的委托'};
    if(!Number.isSafeInteger(Number(qty))||qty<1||qty>100000000) return {ok:false,message:'保证金不足以换算有效股数'};
    if(type==='limit'&&(!Number.isFinite(Number(price))||Number(price)<10||Number(price)>500)) return {ok:false,message:'限价范围为 ¥10–500'};
    if(this.orders.filter(o=>o.owner==='you'&&!o.forced).length>=5) return {ok:false,message:'最多保留 5 笔委托，请先撤单'};
    const order=this.addOrder('you',side,Number(qty),type,price,false,false,budget);
    const p=this.human,state=this.marginState(p),delta=(side==='buy'?1:-1)*Number(qty);
    if(state.deficit>.001){
      this.orders=this.orders.filter(o=>o.id!==order.id);
      const available=this.marginState(p).available;
      return {ok:false,message:`可用保证金 ¥${available.toFixed(2)}，本单连同已有委托超出额度 ¥${state.deficit.toFixed(2)}；请减小金额或手动撤单`};
    }
    return {ok:true,message:`${side==='buy'?'买入':'卖出'} ${qty} 股已委托${type==='limit'?'，GTC 持续有效':'，下一轮开始撮合，余量持续保留'}`};
  }
  cancel(id) { this.orders=this.orders.filter(o=>!(o.owner==='you'&&!o.forced&&(id==null||o.id===id))); }
  flatten() {
    if(this.done||this.human.ruined)return {ok:false,message:'本局已停止交易'};
    this.cancel();
    if(!this.human.shares) return {ok:false,message:'目前没有持仓'};
    const qty=Math.abs(this.human.shares),side=this.human.shares>0?'sell':'buy';
    this.addOrder('you',side,qty,'market',null,false,true);
    return {ok:true,message:'已手动撤掉其他委托并提交只减仓平仓单，按下一轮深度成交'};
  }
  reducePosition(fraction=1) {
    if(this.done||this.human.ruined||!this.human.shares)return {ok:false,message:'当前没有持仓'};
    this.cancel();
    const qty=Math.max(1,Math.floor(Math.abs(this.human.shares)*Math.min(1,Math.max(0,fraction))));
    this.addOrder('you',this.human.shares>0?'sell':'buy',qty,'market',null,false,true);
    return {ok:true,message:`已提交减仓 ${qty} 股委托，并手动撤销其他挂单`};
  }
  makeQuotes() {
    this.orders=this.orders.filter(o=>o.owner!=='maker');
    const middle=(this.forecast[0]+this.forecast[1])/2;
    const center=this.price*.97+middle*.03;
    for(let level=1;level<=24;level++) {
      const qty=12+level*7+Math.floor(this.random()*8);
      const offset=level<=4?level*.004:.016+(level-4)*.009;
      this.addOrder('maker','buy',qty,'limit',Math.max(10,center*(1-offset)));
      this.addOrder('maker','sell',qty,'limit',Math.min(500,center*(1+offset)));
    }
  }
  capacity(p,sign,wanted,execution,mark,orderId=null,reduceOnly=false) {
    if(reduceOnly){
      if(p.shares*sign>=0)return 0;
      wanted=Math.min(wanted,Math.abs(p.shares));
    }
    const valid=q=>{
      const shares=p.shares+sign*q,cash=p.cash-sign*q*execution;
      if(p.id==='maker') return shares>=0&&cash>=-.0001;
      const order=this.orders.find(o=>o.id===orderId);
      if(p.ruined&&!(reduceOnly&&order?.forced))return false;
      const closed=p.shares*sign<0?Math.min(Math.abs(p.shares),q):0,opened=q-closed;
      const leverage=order?.leverage||p.leverage;
      const allocation=opened*execution/leverage;
      if(opened&&(p.liquidating||(p.shares&&this.margin(p,mark)<this.maintenance)))return false;
      const budget=order?order.marginRemaining:this.marginState(p).available;
      if(allocation>budget+.0001)return false;
      if(closed>0&&opened===0)return true;
      const after={...p};this.recordFill(after,sign*q,execution,allocation);
      const remaining=this.orders.map(o=>o.id===orderId?{...o,qty:o.qty-q,marginRemaining:Math.max(0,o.marginRemaining-allocation)}:o);
      return this.marginState(after,mark,remaining).deficit<=.0001;
    };
    let lo=0,hi=Math.floor(wanted);
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(valid(mid))lo=mid;else hi=mid-1;}
    return lo;
  }
  botOrders() {
    const value=(this.forecast[0]+this.forecast[1])/2;
    const old=this.history[Math.max(0,this.history.length-4)].price;
    const momentum=(this.price-old)/old;
    for(const p of this.players.slice(1,4)) {
      if(p.ruined||this.orders.some(o=>o.owner===p.id&&o.forced))continue;
      let side,qty;
      const r=this.random();
      if(p.id==='fox') {
        const stage=this.round%16;
        side=(stage<7&&this.price<value*1.20)?'buy':'sell';
        if(this.round>40)side=p.shares>0?'sell':'buy';
        qty=35+Math.floor(r*70);
        const target=this.intel?.players.find(v=>v.id==='you');
        if(target&&['高','临界'].includes(target.pressure)&&target.position!==0&&r<.65&&this.round<=43){
          side=target.position>0?'sell':'buy';qty+=25;
        }
      } else if(p.id==='wind') {
        side=Math.abs(momentum)>.003?(momentum>0?'buy':'sell'):(r>.5?'buy':'sell');
        qty=15+Math.floor(this.random()*55);
        if(this.round>43)side=this.price<value?'buy':'sell';
      } else {
        const edge=(value-this.price)/this.price;
        if(Math.abs(edge)<.008&&r<.65)continue;
        side=edge>0?'buy':'sell';qty=15+Math.floor(this.random()*45);
      }
      qty=Math.floor(qty*Math.max(1,p.leverage/2));
      qty=this.capacity(p,side==='buy'?1:-1,qty,this.price,this.price);
      if(qty)this.addOrder(p.id,side,qty,'market');
    }
  }
  match() {
    let volume=0,loops=0;
    const bids=this.orders.filter(o=>o.side==='buy'&&o.qty>0).sort((a,b)=>b.price-a.price||Number(b.forced)-Number(a.forced)||a.id-b.id);
    const asks=this.orders.filter(o=>o.side==='sell'&&o.qty>0).sort((a,b)=>a.price-b.price||Number(b.forced)-Number(a.forced)||a.id-b.id);
    for(const bid of bids) {
      for(const ask of asks) {
        if(++loops>10000)break;
        if(!bid.qty||!ask.qty||!this.orders.includes(bid)||!this.orders.includes(ask)||bid.owner===ask.owner||bid.price<ask.price)continue;
        let price;
        if(bid.type==='market'&&ask.type==='market')price=this.price;
        else if(bid.type==='market')price=ask.price;
        else if(ask.type==='market')price=bid.price;
        else price=bid.id<ask.id?bid.price:ask.price;
        price=Math.max(ask.price,Math.min(bid.price,price));
        price=Math.max(10,Math.min(500,Math.round(price*100)/100));
        const buyer=this.account(bid.owner),seller=this.account(ask.owner);
        let qty=Math.min(bid.qty,ask.qty);
        const buyAllowed=this.capacity(buyer,1,qty,price,price,bid.id,bid.reduceOnly);
        const sellAllowed=this.capacity(seller,-1,qty,price,price,ask.id,ask.reduceOnly);
        if(buyAllowed<qty&&buyer.id!=='maker')bid.blockReason=bid.reduceOnly?'仅减仓限制':'保证金限制';
        if(sellAllowed<qty&&seller.id!=='maker')ask.blockReason=ask.reduceOnly?'仅减仓限制':'保证金限制';
        qty=Math.min(qty,buyAllowed,sellAllowed);
        if(!qty)continue;
        const buyOpened=qty-(buyer.shares<0?Math.min(qty,Math.abs(buyer.shares)):0);
        const sellOpened=qty-(seller.shares>0?Math.min(qty,seller.shares):0);
        const buyMargin=buyer.id==='maker'?0:buyOpened*price/bid.leverage,sellMargin=seller.id==='maker'?0:sellOpened*price/ask.leverage;
        const previousPrice=this.price;
        const equityBefore=Object.fromEntries(this.players.slice(0,4).map(p=>[p.id,this.equity(p)]));
        this.recordFill(buyer,qty,price,buyMargin);this.recordFill(seller,-qty,price,sellMargin);
        bid.marginRemaining=Math.max(0,bid.marginRemaining-buyMargin);ask.marginRemaining=Math.max(0,ask.marginRemaining-sellMargin);
        bid.qty-=qty;ask.qty-=qty;buyer.trades++;seller.trades++;
        this.price=price;volume+=qty;
        const aggressive=bid.type==='market'&&ask.type!=='market'?bid:ask.type==='market'&&bid.type!=='market'?ask:bid.id>ask.id?bid:ask;
        const trade={round:this.round,price,previousPrice,aggressor:aggressive.owner,qty,buyer:bid.owner,seller:ask.owner,bidId:bid.id,askId:ask.id,forced:bid.forced||ask.forced,forcedBuyer:bid.forced,forcedSeller:ask.forced};
        this.trades.unshift(trade);
        this.checkMargin({...trade,equityBefore});
      }
    }
    this.orders=this.orders.filter(o=>o.qty>0);return volume;
  }
  checkBankruptcies(trade=null) {
    for(const p of this.players.slice(0,4)) {
      if(p.ruined||this.equity(p)>0)continue;
      const candidate=trade?this.account(trade.aggressor):null;
      const crossed=trade&&trade.equityBefore?.[p.id]>0&&trade.price!==trade.previousPrice;
      const attacker=crossed&&!trade.forced&&candidate?.id!=='maker'&&candidate?.id!==p.id?candidate:null;
      p.ruined=true;p.outRound=this.round;p.defeatedBy=attacker?.id||null;
      if(attacker)attacker.kills++;
      this.orders=this.orders.filter(o=>o.owner!==p.id||o.forced);
      this.knockouts.push({id:this.knockouts.length+1,round:this.round,victim:p.id,attacker:attacker?.id||null,price:this.price,equity:this.equity(p),source:this.done?'settlement':trade?.forced?'cascade':candidate?.id===p.id?'self':attacker?'attack':'market'});
      this.news(attacker?.id==='you'?'击败对手':'破产退赛',attacker?`${attacker.name}的成交导致${p.name}净资产归零，${p.name}已破产退赛。`:`${p.name}账户净资产不高于零，已破产退赛。`,'danger');
    }
  }
  checkMargin(trade=null) {
    this.checkBankruptcies(trade);
    let found=false;
    for(const p of this.players.slice(0,4)) {
      if(!p.shares)continue;
      if(p.autoTopUp&&!p.ruined&&!p.liquidating&&this.margin(p)<this.maintenance*2){
        const needed=Math.abs(p.shares*this.price)*.1-this.positionEquity(p);
        const add=Math.min(Math.max(0,needed),this.marginState(p).available);
        if(add>.001)this.addMargin(add,p,true);
      }
      if(p.ruined||p.liquidating||this.margin(p)<this.maintenance||this.positionEquity(p)<=0) {
        if(this.orders.some(o=>o.owner===p.id&&o.forced))continue;
        this.orders=this.orders.filter(o=>o.owner!==p.id);
        this.addOrder(p.id,p.shares>0?'sell':'buy',Math.abs(p.shares),'market',null,true);
        if(!p.liquidating){p.forced++;this.news('强制平仓',`${p.name}触发仓位风控，系统提交${p.shares>0?'卖出':'买入'}平仓单；仅当账户净资产不高于零时才退赛。`,'danger');}
        p.liquidating=true;found=true;
      }
    }
    return found;
  }
  disclose() {
    const widths={12:24,24:16,36:8,44:0};
    if(!(this.round in widths))return;
    const width=widths[this.round];
    const center=Math.round(this.finalValue+(this.random()-.5)*width);
    this.forecast=width?[center-width,center+width]:[this.finalValue,this.finalValue];
    const names={12:'订单披露',24:'财报更新',36:'审计快报',44:'兑付价确认'};
    this.news(names[this.round],width?`公司经营线索更新，最终兑付参考区间收窄至 ¥${this.forecast[0]}–${this.forecast[1]}。`:`最终兑付价确认为 ¥${this.finalValue}。还剩 4 轮，未平仓头寸将按此价格结算。`,'news');
  }
  captureIntel() {
    const trades=this.trades.filter(t=>t.round===this.round);
    const band=value=>value===0?[0,0]:value<25?[1,24]:value<75?[25,74]:value<150?[75,149]:value<300?[150,299]:[300,null];
    const players=this.players.slice(0,4).map(p=>{
      let bought=0,sold=0,forced=false;
      for(const t of trades){if(t.buyer===p.id)bought+=t.qty;if(t.seller===p.id)sold+=t.qty;if((t.forcedBuyer&&t.buyer===p.id)||(t.forcedSeller&&t.seller===p.id))forced=true;}
      const net=bought-sold,pressure=this.fundingPressure(p);
      return {id:p.id,position:Math.sign(p.shares),flow:Math.sign(net),size:band(Math.abs(net)),turnover:band(bought+sold),active:bought+sold>0,pressure,forced,ruined:p.ruined};
    });
    this.intel={round:this.round,change:(this.price/this.lastPrice-1)*100,players};
    this.intelHistory.push(this.intel);this.intelHistory=this.intelHistory.slice(-3);
  }
  step() {
    if(this.done)return;
    const submitted=this.orders.filter(o=>o.owner==='you'&&o.type==='market'&&!o.forced).map(o=>({order:o,qty:o.qty}));
    const forcedBefore=this.human.forced;
    this.round++;this.lastPrice=this.price;
    this.orders=this.orders.filter(o=>o.expires===null||o.expires>=this.round);
    for(const order of this.orders){
      delete order.blockReason;
      if(order.type==='market'&&order.expires===null){
        order.reference=this.price;
        order.price=Math.round(this.price*(order.side==='buy'?1+this.marketProtection:1-this.marketProtection)*100)/100;
      }
    }
    this.checkMargin();this.botOrders();
    let volume=0;
    for(let pass=0;pass<5;pass++){const filled=this.match();volume+=filled;this.checkMargin();if(!filled)break;}
    for(const ticket of submitted){
      const filled=this.trades.filter(t=>t.round===this.round&&(t.bidId===ticket.order.id||t.askId===ticket.order.id)).reduce((sum,t)=>sum+t.qty,0);
      const unfilled=ticket.qty-filled;
      const retained=this.orders.some(o=>o.id===ticket.order.id);
      const reason=ticket.order.blockReason||'本轮保护价格内的盘口流动性不足';
      const remaining=unfilled?(retained?(this.round>=this.totalRounds?`余下 ${unfilled} 股未成交，将随本局收盘撤销。`:`余下 ${unfilled} 股因${reason}未成交，继续保留，下一轮撮合；剩余预算仍冻结。`):`余下 ${unfilled} 股因${this.human.forced>forcedBefore?'强平风控':'委托已结束'}撤销。`):'已全部成交。';
      this.news('委托回执',`你的市价${ticket.order.side==='buy'?'买':'卖'}单本轮待成交 ${ticket.qty} 股，成交 ${filled} 股。${remaining}`);
    }
    // Unfinished system closes resume next round; only player orders persist indefinitely.
    this.orders=this.orders.filter(o=>o.expires===null);
    for(const p of this.players.slice(0,4)){
      const eq=this.equity(p);p.peak=Math.max(p.peak,eq);p.drawdown=Math.max(p.drawdown,(p.peak-eq)/p.peak);
    }
    this.lastVolume=volume;this.totalVolume+=volume;
    this.history.push({round:this.round,price:this.price,volume,equity:this.equity(this.human)});
    this.captureIntel();
    const change=(this.price/this.lastPrice-1)*100;
    if(Math.abs(change)>=1.5)this.news(change>0?'买盘推动':'抛压涌现',`本轮成交 ${volume} 股，价格${change>0?'上涨':'下跌'} ${Math.abs(change).toFixed(2)}%。`);
    this.disclose();
    const survivors=this.players.slice(0,4).filter(p=>!p.ruined);
    if(survivors.length<=1||this.round>=this.totalRounds){this.settle(survivors.length<=1?'last-standing':'time');return;}
    this.makeQuotes();
  }
  settle(reason='time') {
    if(this.done)return;
    this.done=true;this.endReason=reason;this.orders=[];
    for(const p of this.players){p.settledShares=p.shares;if(p.shares)this.recordFill(p,-p.shares,this.finalValue,0);p.positionMargin=0;}
    this.checkBankruptcies();
    this.winnerId=this.rankings().find(p=>!p.ruined)?.id||null;
    this.news('收盘结算',`全部股票按 ¥${this.finalValue} 兑付，借款与空头负债已计入最终净资产。`,'news');
  }
  rankings() {return this.players.slice(0,4).map(p=>({...p,equity:this.equity(p)})).sort((a,b)=>Number(a.ruined)-Number(b.ruined)||(a.ruined&&b.ruined?b.outRound-a.outRound:0)||b.equity-a.equity);}
  book(side) {
    const levels=new Map();
    for(const o of this.orders.filter(o=>o.side===side&&o.type==='limit'))levels.set(o.price,(levels.get(o.price)||0)+o.qty);
    return [...levels].map(([price,qty])=>({price,qty})).sort((a,b)=>side==='buy'?b.price-a.price:a.price-b.price).slice(0,5);
  }
  summary() {return {seed:this.seed,price:this.price,round:this.round,done:this.done,winnerId:this.winnerId,knockouts:this.knockouts,finalValue:this.done?this.finalValue:null,players:this.players.map(p=>({id:p.id,cash:p.cash,shares:p.shares,equity:this.equity(p),ruined:p.ruined,kills:p.kills}))};}
}
