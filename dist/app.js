import {MarketGame} from './engine.js?v=6';
const $=id=>document.getElementById(id);
const replaySeed=Number(new URLSearchParams(location.search).get('seed'));
const initialSeed=Number.isSafeInteger(replaySeed)&&replaySeed>0&&replaySeed<=4294967295?replaySeed:Date.now();
let game=new MarketGame(initialSeed), running=false, countdown=10, orderType='market', allocationPercent=25, customAmount=false, feedMode='news', toastTimer=0, resultsShown=false, seenKnockouts=0;
const fmt=(n,d=2)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=n=>`${n<0?'−':''}¥${fmt(Math.abs(n))}`;
const signed=n=>`${n>=0?'+':'−'}¥${fmt(Math.abs(n))}`;
const phase=()=>game.done?(game.endReason==='last-standing'?'生存赛结束':'已收盘'):game.human.ruined?'观战中':game.round===0?'开盘准备':game.round>=44?'兑付倒计时':game.round>=36?'审计阶段':game.round>=24?'财报阶段':game.round>=12?'信息披露':'自由交易';
function toast(message,error=false){$('toast').textContent=message;$('toast').className=`show${error?' error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').className='',3300);}
function result(r){if(r.message)toast(r.message,!r.ok);render();return r.ok;}
function setRunning(value){running=value&&!game.done;countdown=Number($('speed').value);renderControls();}
function renderControls(){
  $('pause').textContent=game.done?'已收盘':running?'Ⅱ 暂停':'▶ 自动推进';
  $('pause').disabled=game.done;$('next').disabled=game.done;
  $('countdown').textContent=game.done?'已结算':running?`${countdown}s 下一轮`:'已暂停';
}
function advance(){
  if(game.done)return;const before=game.trades.length;
  game.step();render();
  if(game.done)setRunning(false);
  if(showNextKnockout())return;
  if(game.done){if(!resultsShown){resultsShown=true;showResults();}}
  else if(game.trades.length>before&&game.trades.slice(0,game.trades.length-before).some(t=>t.buyer==='you'||t.seller==='you')){
    $('chartTip').textContent='你的订单已成交 · 查看「我的成交」了解明细';
  }
}
function render(){
  const p=game.human,eq=game.equity(p),profit=eq-20000,rank=game.rankings().findIndex(p=>p.id==='you')+1;
  const change=(game.price/100-1)*100;
  $('price').textContent=fmt(game.price);$('price').className=change>=0?'up':'down';
  $('change').textContent=`${change>=0?'+':''}${fmt(change)}%`;$('change').className=change>=0?'up':'down';
  $('volume').textContent=`${game.lastVolume} 股`;
  const prices=game.history.map(h=>h.price);
  $('highlow').textContent=`${fmt(Math.max(...prices))} / ${fmt(Math.min(...prices))}`;
  $('forecast').textContent=game.forecast[0]===game.forecast[1]?`¥${game.forecast[0]} 已确认`:`¥${game.forecast[0]} – ${game.forecast[1]}`;
  $('phase').textContent=phase();$('round').textContent=`第 ${String(game.round).padStart(2,'0')} / 48 轮`;
  $('progress').style.width=`${game.round/48*100}%`;
  $('equity').textContent=money(eq);$('pnl').textContent=`${signed(profit)} (${profit>=0?'+':''}${fmt(profit/200)}%)`;
  $('pnl').className=`account-pnl ${profit>=0?'up':'down'}`;
  $('cash').textContent=money(p.cash);$('cash').className=p.cash<0?'down':'';
  $('position').textContent=p.shares===0?'空仓':`${p.shares>0?'多头':'空头'} ${Math.abs(p.shares)} 股`;
  $('position').className=p.shares<0?'down':'';
  $('exposure').textContent=p.ruined?'已破产':`${fmt(game.exposure(p))}×`;$('rank').textContent=`#${rank} / 4`;
  const liquidation=game.liquidationPrice(p);
  $('liquidation').textContent=liquidation?`¥${fmt(liquidation)}`:'—';
  const ratio=game.margin(p),pressure=game.fundingPressure(p),risk=p.ruined?0:{'低':1,'中':.7,'高':.35,'临界':.1,'穿仓':0}[pressure];
  $('riskbar').style.width=`${p.ruined?0:game.done?100:risk*100}%`;
  $('riskbar').style.background=risk<.12?'var(--red)':risk<=.35?'var(--orange)':'var(--green)';
  $('riskText').textContent=p.ruined?'已破产退赛':game.done?'已结算':ratio<game.maintenance?'触发强平':pressure==='临界'?'接近平仓线':pressure==='高'?'资金偏紧':pressure==='中'?'有杠杆敞口':'充足';
  $('riskText').style.color=risk<.12?'var(--red)':risk<=.35?'var(--orange)':'var(--green)';
  $('latestNews').textContent=game.events[0].text;
  for(const side of ['buy','sell']){
    let levels=game.book(side);if(side==='sell')levels.reverse();
    const max=Math.max(25,...levels.map(l=>l.qty));
    $(side==='buy'?'bids':'asks').innerHTML=levels.length?levels.map(l=>`<div class="book-row ${side==='buy'?'bid':'ask'}" style="--depth:${l.qty/max*100}%"><span>${fmt(l.price)}</span><span>${l.qty}</span></div>`).join(''):'<div class="empty-feed">暂无报价</div>';
  }
  $('bookPrice').textContent=fmt(game.price);
  $('players').innerHTML=game.rankings().map((p,i)=>`<div class="player-row ${p.ruined?'eliminated':''}"><span class="player-rank">0${i+1}</span><span class="avatar" style="--player-color:${p.color}">${p.id==='you'?'你':p.name[0]}</span><div class="player-info"><strong>${p.name}</strong>${p.id==='you'?'<b class="you-label">YOU</b>':''}<span>${p.style} · 击败 ${p.kills} 人${p.ruined?' · 已退赛':''}</span></div><span class="player-status ${p.id==='you'?'up':''}">${p.ruined?'破产退赛':p.id==='you'?`${profit>=0?'+':''}${fmt(profit/200)}%`:game.done?money(p.equity):p.liquidating?'强平进行中':p.forced?'强平后仍存活':'仓位隐藏'}</span></div>`).join('');
  const survivors=game.players.slice(0,4).filter(v=>!v.ruined).length;
  $('survivorCount').textContent=`${survivors} / 4 人存活`;$('killCount').textContent=`你已击败 ${p.kills} 人`;
  $('eliminatedNotice').hidden=!p.ruined;
  const lastKO=game.knockouts.at(-1);
  $('battleLatest').textContent=lastKO?`${lastKO.attacker?game.account(lastKO.attacker).name+' 击败 ':''}${game.account(lastKO.victim).name}${lastKO.attacker?'':'破产退赛'}`:'净资产归零才退赛 · 强平后有钱仍可反击';
  const roundChange=(game.price/game.lastPrice-1)*100;
  $('impactNotice').hidden=game.round===0||Math.abs(roundChange)<5;
  $('impactNotice').textContent=`本轮${roundChange>=0?'上涨':'下跌'} ${fmt(Math.abs(roundChange))}% · 大单逐档成交，强平可能放大波动`;
  document.querySelectorAll('[data-leverage]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.leverage)===p.leverage));
  $('leverageLabel').textContent=`${p.leverage}×`;
  $('leverageSlider').value=p.leverage;$('leverageSlider').style.setProperty('--slider-progress',`${(p.leverage-1)/19*100}%`);
  $('leverageHint').textContent='新单按所选倍数分配保证金，已有仓位不会自动增减保证金。';
  $('leverageSlider').disabled=game.done||p.ruined;
  const pending=game.orders.filter(o=>o.owner==='you');$('pendingCount').textContent=pending.length;
  const funds=game.marginState(p);
  $('eligibleCollateral').textContent=money(funds.eligible);$('usedMargin').textContent=money(funds.used);
  $('reservedMargin').textContent=money(funds.reserved);$('availableMargin').textContent=money(funds.available);
  const topUp=Math.min(funds.available,Math.max(1,p.positionMargin*.5));
  $('topUp').textContent=p.shares?`追加 ${money(topUp)} 保证金`:'追加保证金';$('topUp').disabled=game.done||p.ruined||!p.shares||p.liquidating||topUp<.01;
  $('autoTopUp').textContent=`自动救仓：${p.autoTopUp?'开':'关'}`;$('autoTopUp').setAttribute('aria-checked',String(p.autoTopUp));
  $('autoTopUp').classList.toggle('enabled',p.autoTopUp);$('autoTopUp').disabled=game.done||p.ruined;
  $('rescueNote').textContent=p.autoTopUp?'余额支援已开启：仓位保证金率低于 5% 时，尝试用闲置余额补到 10%。':'闲置余额不自动补仓。若跳价导致清算亏损超过仓位保证金，仍会扣减账户净资产。';
  const unrealized=game.unrealized(p),realized=p.realized;
  const sideText=p.shares>0?'多头':p.shares<0?'空头':'空仓';
  $('holdingShares').textContent=p.shares?`${sideText} ${Math.abs(p.shares)} 股`:'当前空仓';
  $('holdingShares').className=p.shares<0?'down':p.shares>0?'up':'muted';
  $('holdingCost').textContent=p.shares?money(p.averageCost):'—';
  $('holdingNotional').textContent=money(Math.abs(p.shares*game.price));
  $('holdingUnrealized').textContent=signed(unrealized);$('holdingUnrealized').className=unrealized>=0?'up':'down';
  $('holdingRealized').textContent=signed(realized);$('holdingRealized').className=realized>=0?'up':'down';
  $('holdingLeverage').textContent=p.shares?(game.positionEquity(p)<=0?'仓位穿仓':`${fmt(game.positionLeverage(p))}×`):'—';
  $('holdingMargin').textContent=money(p.positionMargin);
  $('holdingRoi').textContent=p.positionMargin>0?`${unrealized>=0?'+':''}${fmt(unrealized/p.positionMargin*100)}%`:'—';$('holdingRoi').className=unrealized>=0?'up':'down';
  $('holdingLiquidation').textContent=liquidation?money(liquidation):'—';
  $('holdingStatus').textContent=p.ruined?(p.shares?'破产退赛 · 系统清算中':'破产退赛 · 仅可观战'):game.done?`已按 ¥${game.finalValue} 兑付`:p.liquidating?'正在强制平仓':p.shares?(p.autoTopUp?'自动救仓已开启':'余额未自动补仓 · 强平不等于退赛'):'开局空仓 · 成交后自动显示';
  $('positionPending').textContent=pending.length?`${pending.length} 笔待成交 · 尚未计入持仓`:'仅已成交计入持仓';
  $('dockPosition').textContent=p.ruined?'已破产退赛 · 仅可观战':`${p.shares?`${sideText} ${Math.abs(p.shares)} 股`:'空仓'} · 浮盈 ${signed(unrealized)}`;
  $('pending').innerHTML=pending.length?pending.map(o=>`<div class="pending-order"><span class="${o.side==='buy'?'up':'down'}">${o.forced?'强平':o.side==='buy'?'买入':'卖出'}</span><span>${o.qty} 股 · ${o.type==='market'?'市价':`¥${fmt(o.price)}`}<small>${o.forced?'强平处理中':`${o.type==='limit'?'GTC':'持续市价'} · 已挂 ${game.round-o.created} 轮 · 累计成交 ${o.initialQty-o.qty}/${o.initialQty} 股${o.reduceOnly?' · 仅减仓':''}`}${!o.forced&&!o.reduceOnly?` · 冻结预算 ${money(o.marginRemaining)}`:''}${o.blockReason?` · ${o.blockReason}，等待可成交条件`:''}</small></span>${o.forced?'<small>系统委托</small>':`<button data-cancel="${o.id}" aria-label="撤销委托">×</button>`}</div>`).join(''):`<div class="empty-orders">${p.ruined?(p.shares?`剩余 ${Math.abs(p.shares)} 股由系统继续清算`:'已破产退赛，不能再提交委托'):p.liquidating?'强平尚未完成，系统将于下一轮继续清算':'暂无委托，拖动金额比例后下单'}</div>`;
  ['buy','sell','qty','minus','plus','limitPrice'].forEach(id=>$(id).disabled=game.done||p.ruined||p.liquidating);
  $('flatten').disabled=game.done||p.ruined||p.liquidating||!p.shares;
  document.querySelectorAll('[data-percent],[data-leverage],[data-type]').forEach(b=>b.disabled=game.done||p.ruined||p.liquidating);
  document.querySelectorAll('[data-reduce]').forEach(b=>b.disabled=game.done||p.ruined||!p.shares||p.liquidating);
  $('amountSlider').disabled=game.done||p.ruined||p.liquidating||funds.available<.01;
  syncAllocation();
  renderIntel();renderFeed();renderEstimate();renderControls();drawChart();
}
function renderIntel(){
  const intel=game.intel;
  $('intelRound').textContent=intel?`上一轮 R${String(intel.round).padStart(2,'0')} · 已结束`:'首轮结束后公开';
  const band=range=>range[1]===null?`≥${range[0]} 股`:range[0]===0?'净额为 0':`${range[0]}–${range[1]} 股`;
  const pressureClass=s=>s==='临界'||s==='穿仓'?'critical':s==='高'?'high':s==='中'?'medium':'low';
  const cards=game.players.slice(1,4).map(p=>{
    const info=intel?.players.find(v=>v.id===p.id);
    if(p.ruined)return `<article class="intel-card eliminated-intel"><div class="intel-name"><span class="avatar" style="--player-color:${p.color}">${p.name[0]}</span><strong>${p.name}</strong></div><div class="intel-flow down">已破产退赛</div><p class="intel-wait">${p.defeatedBy?`被 ${game.account(p.defeatedBy).name} 击败`:'账户净资产不高于零'} · R${p.outRound}</p></article>`;
    if(!info)return `<article class="intel-card"><div class="intel-name"><span class="avatar" style="--player-color:${p.color}">${p.name[0]}</span><strong>${p.name}</strong><span>${p.style}</span></div><div class="intel-locked">首轮成交后解锁</div><p class="intel-wait">观察已经发生的行动，再推理下一步。</p></article>`;
    const history=game.intelHistory.map(s=>({round:s.round,...s.players.find(v=>v.id===p.id)}));
    const flow=info.flow>0?'净买入':info.flow<0?'净卖出':info.active?'双向换手':'无成交';
    return `<article class="intel-card"><div class="intel-name"><span class="avatar" style="--player-color:${p.color}">${p.name[0]}</span><strong>${p.name}</strong><span>${p.style}</span></div><div class="intel-flow ${info.flow>0?'up':info.flow<0?'down':'muted'}">${flow}<strong>${info.active?band(info.size):'—'}</strong></div><div class="intel-details"><span>仓位倾向<strong>${info.position>0?'偏多':info.position<0?'偏空':'空仓'}</strong></span><span>资金压力<strong class="pressure-${pressureClass(info.pressure)}">${info.pressure}${info.forced?' · 已强平':''}</strong></span></div><div class="intel-recent"><span>近三轮净流向</span><div>${history.map(h=>`<b class="flow-chip ${h.flow>0?'positive':h.flow<0?'negative':'neutral'}" title="第${h.round}轮">R${h.round} ${h.flow>0?'买':h.flow<0?'卖':h.active?'平':'静'}</b>`).join('')}</div></div></article>`;
  });
  $('intelCards').innerHTML=cards.join('');
  if(!intel){$('intelInsight').textContent='先推进一轮，看看谁在买、谁在卖，以及谁的资金开始吃紧。';return;}
  let insight='净买入也可能是回补空头；净卖出也可能只是减持。结合仓位倾向与资金压力判断。';
  for(const p of game.players.slice(1,4)){
    if(p.ruined)continue;
    const info=intel.players.find(v=>v.id===p.id),recent=game.intelHistory.map(s=>s.players.find(v=>v.id===p.id).flow);
    if(['高','临界','穿仓'].includes(info.pressure)&&info.position<0&&intel.change>0){insight=`${p.name}上轮偏空、资金压力偏高，股价却在上涨。可以观察是否出现被迫回补；确切平仓位仍未知。`;break;}
    if(['高','临界','穿仓'].includes(info.pressure)&&info.position>0&&intel.change<0){insight=`${p.name}上轮偏多、资金压力偏高，股价却在下跌。留意被动减仓压力，也要防止对方反向拉升自救。`;break;}
    if(info.flow<0&&intel.change>0){insight=`${p.name}在上一轮上涨时净卖出，出现逢高减仓迹象。这可能是出货，也可能是转向做空。`;break;}
    if(recent.length>=2&&recent.slice(-2).every(v=>v===1))insight=`${p.name}连续两轮净买入，存在累积筹码或回补空单的迹象。结合其仓位方向判断，下一轮仍可能反手。`;
  }
  $('intelInsight').innerHTML=`<strong>推理线索</strong><span>${insight}</span>`;
}
function renderFeed(){
  if(feedMode==='news')$('feed').innerHTML=game.events.slice(0,25).map(e=>`<div class="feed-item ${e.type}"><i class="feed-marker"></i><div><strong>${e.title}</strong><time>R${String(e.round).padStart(2,'0')}</time><p>${e.text}</p></div></div>`).join('');
  else {
    const ts=game.trades.filter(t=>t.buyer==='you'||t.seller==='you');
    $('feed').innerHTML=ts.length?ts.slice(0,35).map(t=>`<div class="feed-item"><i class="feed-marker" style="background:${t.buyer==='you'?'var(--green)':'var(--red)'}"></i><div><strong class="${t.buyer==='you'?'up':'down'}">${(t.buyer==='you'?t.forcedBuyer:t.forcedSeller)?'强制平仓 · ':''}${t.buyer==='you'?'买入':'卖出'} ${t.qty} 股</strong><time>R${String(t.round).padStart(2,'0')}</time><p>成交价 ¥${fmt(t.price)} · 金额 ¥${fmt(t.price*t.qty)}</p></div></div>`).join(''):'<div class="empty-feed">还没有成交。提交委托后，推进一轮即可撮合。</div>';
  }
}
function orderQuantity(){return game.quantityForMargin(Number($('qty').value),orderType,Number($('limitPrice').value));}
function syncAllocation(keepInput=false){
  const max=Math.max(0,Math.floor((game.marginState(game.human).available+1e-7)*100)/100);
  $('qty').max=max;$('maxAllocation').textContent=money(max);
  const amount=customAmount?Math.min(max,Math.max(0,Number($('qty').value)||0)):Math.floor(max*allocationPercent+1e-7)/100;
  if(!keepInput||Number($('qty').value)>max||Number($('qty').value)<0)$('qty').value=amount.toFixed(2);
  const percent=max>0?Math.min(100,amount/max*100):0;
  $('amountSlider').value=max===0?0:customAmount?Math.round(percent):allocationPercent;
  $('allocationPercent').textContent=`${fmt(percent,percent%1===0?0:1)}%`;
  $('amountSlider').style.setProperty('--allocation-progress',`${percent}%`);
  document.querySelectorAll('[data-percent]').forEach(b=>b.classList.toggle('selected',Math.abs(Number(b.dataset.percent)-percent)<.05));
}
function renderEstimate(){
  const qty=orderQuantity(),price=orderType==='limit'?Number($('limitPrice').value):game.price;
  const amount=Number($('qty').value)||0,available=game.marginState(game.human).available;
  $('previewQuantity').textContent=`约 ${fmt(qty,0)} 股`;$('estimate').textContent=money(qty*price);$('previewMargin').textContent=money(amount);
  const effect=side=>{
    const sign=side==='buy'?1:-1,p=game.human;
    const closed=p.shares*sign<0?Math.min(Math.abs(p.shares),qty):0,opened=qty-closed;
    return [closed?`平${p.shares>0?'多':'空'} ${closed} 股`:'',opened?`开${sign>0?'多':'空'} ${opened} 股`:''].filter(Boolean).join('，')||'无委托';
  };
  $('orderEffect').textContent=`买单：${effect('buy')}；卖单：${effect('sell')}。`;
  $('buyReserve').textContent=money(amount);$('sellReserve').textContent=money(Math.max(0,available-amount));
  const disabled=game.done||game.human.ruined||game.human.liquidating||qty<1||amount>available+.001;
  $('buy').disabled=disabled;$('sell').disabled=disabled;
}
function drawChart(){
  const canvas=$('chart'),rect=canvas.getBoundingClientRect();if(!rect.width)return;
  const dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const w=rect.width,h=rect.height,left=3,right=46,top=14,bottom=h-44,volumeH=33;
  const values=game.history.map(p=>p.price),span=Math.max(8,Math.max(...values)-Math.min(...values)),lo=Math.min(...values)-span*.22,hi=Math.max(...values)+span*.22;
  const x=r=>left+r/48*(w-left-right),y=p=>top+(hi-p)/(hi-lo)*(bottom-top-volumeH);
  ctx.font='9px ui-monospace, monospace';ctx.textAlign='left';
  for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4,yy=y(v);ctx.strokeStyle='#293226';ctx.lineWidth=.7;ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right+2,yy);ctx.stroke();ctx.fillStyle='#768b68';ctx.fillText(fmt(v),w-right+9,yy+3);}
  ctx.setLineDash([]);
  for(const r of [0,12,24,36,48]){const xx=x(r);ctx.strokeStyle='#283324';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom+8);ctx.stroke();ctx.fillStyle='#6d825e';ctx.textAlign=r===0?'left':r===48?'right':'center';ctx.fillText(r===0?'开盘':`R${r}`,xx,h-5);}
  ctx.textAlign='left';
  const maxvol=Math.max(100,...game.history.map(p=>p.volume));
  for(let i=1;i<game.history.length;i++){const p=game.history[i],prev=game.history[i-1],bar=Math.max(1,(w-left-right)/48*.6);ctx.fillStyle=p.price>=prev.price?'#b8f57038':'#ef8b8738';ctx.fillRect(x(p.round)-bar/2,bottom-p.volume/maxvol*volumeH,bar,p.volume/maxvol*volumeH);}
  ctx.beginPath();game.history.forEach((p,i)=>i?ctx.lineTo(x(p.round),y(p.price)):ctx.moveTo(x(p.round),y(p.price)));
  if(game.history.length===1){ctx.lineTo(x(1),y(100));}
  ctx.strokeStyle='#b8f570';ctx.lineWidth=2;ctx.lineJoin='round';ctx.stroke();
  const last=game.history.at(-1),lastX=x(last.round||1),lastY=y(last.price);
  ctx.lineTo(lastX,bottom-volumeH);ctx.lineTo(x(0),bottom-volumeH);ctx.closePath();const gradient=ctx.createLinearGradient(0,top,0,bottom-volumeH);gradient.addColorStop(0,'#b8f57022');gradient.addColorStop(1,'#b8f57000');ctx.fillStyle=gradient;ctx.fill();
  ctx.beginPath();ctx.arc(lastX,lastY,3,0,Math.PI*2);ctx.fillStyle='#b8f570';ctx.fill();
  ctx.setLineDash([3,4]);ctx.strokeStyle='#78965b';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(lastX,lastY);ctx.lineTo(w-right+2,lastY);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#334a24';ctx.fillRect(w-right+4,lastY-8,42,16);ctx.fillStyle='#d3edbd';ctx.font='9px ui-monospace, monospace';ctx.fillText(fmt(last.price),w-right+7,lastY+3);
}
function showNextKnockout(){
  if($('knockout').open)return true;
  const event=game.knockouts[seenKnockouts];if(!event)return false;
  seenKnockouts++;setRunning(false);
  const victim=game.account(event.victim),attacker=event.attacker?game.account(event.attacker):null;
  const won=attacker?.id==='you',lost=victim.id==='you';
  $('knockout').classList.toggle('knockout-win',won);$('knockout').classList.toggle('knockout-loss',lost);
  $('knockoutBadge').textContent=won?'KNOCKOUT':lost?'BANKRUPT':'MARKET ELIMINATION';
  $('knockoutTitle').textContent=won?`恭喜你击败了${victim.name}！`:lost?'你已破产退赛':attacker?`${attacker.name}击败了${victim.name}`:`${victim.name}破产退赛`;
  $('knockoutDetail').textContent=`${victim.name}账户净资产降至 ${money(event.equity)}，本局交易资格已结束。${attacker?'击败归因于使净资产跌破零的主动成交。':event.source==='cascade'?'强平成交引发连锁破产。':event.source==='settlement'?'最终兑付结算确认亏损。':'本次未归因于其他玩家。'}${lost?'你可以继续观战，或另开一局。':''}`;
  $('knockoutContinue').textContent=seenKnockouts<game.knockouts.length?'查看下一条战况':game.done?'查看比赛结果':lost?'继续观战':'继续对局';
  $('knockout').showModal();return true;
}
function closeKnockout(){
  $('knockout').close();if(showNextKnockout())return;
  if(game.done&&!resultsShown){resultsShown=true;showResults();}
}
function showResults(){
  const rankings=game.rankings(),rank=rankings.findIndex(p=>p.id==='you')+1,p=game.human,profit=p.cash-20000;
  $('resultIcon').textContent=game.winnerId==='you'?'♛':p.ruined?'×':'↗';$('resultTitle').textContent=game.winnerId==='you'?(game.endReason==='last-standing'?'你是最后的幸存者！':'你带着最多的钱离场。'):game.winnerId?`${game.account(game.winnerId).name}赢得本局`: '全员破产，本局无人获胜';
  $('resultSubtitle').textContent=`最终每股兑付 ¥${game.finalValue}。你的净资产 ${money(p.cash)}，本局${profit>=0?'盈利':'亏损'} ${money(Math.abs(profit))}。`;
  $('resultStandings').innerHTML=rankings.map((p,i)=>`<div class="result-row ${p.id==='you'?'you':''}"><span>0${i+1}</span><strong>${p.name}${p.id==='you'?' · YOU':''}${p.ruined?' · 破产退赛':''}</strong><div><b>${money(p.equity)}</b><small>${p.equity>=20000?'+':''}${fmt((p.equity-20000)/200)}%</small></div></div>`).join('');
  $('resultStats').innerHTML=`<div>你的成交笔数<strong>${p.trades}</strong></div><div>盘中最大回撤<strong>${fmt(p.drawdown*100)}%</strong></div><div>强平 / 击败人数<strong>${p.forced} / ${p.kills}</strong></div>`;
  if(!$('results').open)$('results').showModal();
}
function newGame(){
  setRunning(false);if($('results').open)$('results').close();if($('knockout').open)$('knockout').close();game=new MarketGame();resultsShown=false;seenKnockouts=0;
  $('limitPrice').value=100;allocationPercent=25;customAmount=false;$('chartTip').textContent='每笔成交都来自真实的模拟订单撮合';render();toast('新一局已准备。拖动可用余额比例，选倍数，再买入或做空。');
}
$('knockoutContinue').onclick=closeKnockout;
$('knockoutNewGame').onclick=newGame;
$('knockout').addEventListener('cancel',e=>{e.preventDefault();closeKnockout();});
$('pause').onclick=()=>setRunning(!running);
$('next').onclick=()=>{setRunning(false);advance();};
$('start').onclick=()=>{$('welcome').close();render();toast('用金额比例滑杆下单；默认余额不救仓，必要时可以一键补充。');};
$('restart').onclick=()=>{if(game.round>0&&!game.done){if(!confirm('结束当前对局并重新开局？'))return;}newGame();};
$('playAgain').onclick=newGame;
$('closeResults').onclick=$('review').onclick=()=>$('results').close();
for(const id of ['help','rulesFooter','tutorial'])$(id).onclick=()=>{setRunning(false);if(!$('rules').open)$('rules').showModal();};
$('closeRules').onclick=$('gotIt').onclick=()=>$('rules').close();
$('speed').onchange=()=>{countdown=Number($('speed').value);renderControls();};
$('qty').oninput=()=>{customAmount=true;syncAllocation(true);renderEstimate();};$('limitPrice').oninput=renderEstimate;
$('plus').onclick=()=>{customAmount=true;$('qty').value=Math.min(Number($('qty').max),(Number($('qty').value)||0)+100);syncAllocation();renderEstimate();};
$('minus').onclick=()=>{customAmount=true;$('qty').value=Math.max(0,(Number($('qty').value)||0)-100);syncAllocation();renderEstimate();};
$('amountSlider').oninput=()=>{customAmount=false;allocationPercent=Number($('amountSlider').value);syncAllocation();renderEstimate();};
document.querySelectorAll('[data-percent]').forEach(b=>b.onclick=()=>{customAmount=false;allocationPercent=Number(b.dataset.percent);syncAllocation();renderEstimate();});
document.querySelectorAll('[data-leverage]').forEach(b=>b.onclick=()=>result(game.setLeverage(Number(b.dataset.leverage))));
$('leverageSlider').oninput=()=>result(game.setLeverage(Number($('leverageSlider').value)));
document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{orderType=b.dataset.type;document.querySelectorAll('[data-type]').forEach(t=>t.classList.toggle('selected',t===b));$('limitGroup').hidden=orderType!=='limit';if(orderType==='limit')$('limitPrice').value=game.price;renderEstimate();});
for(const side of ['buy','sell'])$(side).onclick=()=>result(game.submitMargin(side,Number($('qty').value),orderType,Number($('limitPrice').value)));
$('flatten').onclick=()=>result(game.flatten());
document.querySelectorAll('[data-reduce]').forEach(b=>b.onclick=()=>result(game.reducePosition(Number(b.dataset.reduce))));
$('topUp').onclick=()=>result(game.addMargin(Math.min(game.marginState(game.human).available,Math.max(1,game.human.positionMargin*.5))));
$('autoTopUp').onclick=()=>{game.human.autoTopUp=!game.human.autoTopUp;render();toast(game.human.autoTopUp?'自动救仓已开启：闲置余额将按规则支援仓位':'自动救仓已关闭：仓位自行承受亏损');};
$('cancelAll').onclick=()=>{game.cancel();render();toast('已撤销所有可撤委托');};
$('pending').onclick=e=>{const b=e.target.closest('[data-cancel]');if(b){game.cancel(Number(b.dataset.cancel));render();}};
document.querySelectorAll('[data-feed]').forEach(b=>b.onclick=()=>{feedMode=b.dataset.feed;document.querySelectorAll('[data-feed]').forEach(t=>t.classList.toggle('selected',t===b));renderFeed();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)setRunning(false);});
window.addEventListener('resize',drawChart);
setInterval(()=>{if(!running||game.done||$('knockout').open||$('rules').open||$('welcome').open)return;countdown--;if(countdown<=0){countdown=Number($('speed').value);advance();}renderControls();},1000);
render();$('welcome').showModal();
