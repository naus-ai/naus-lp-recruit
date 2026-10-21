/*
 * 面談の予約画面(/ と /2/ で共通)
 * - ページ内の外部予約リンク(calendar.app.google)を押すと、外部に飛ばずにこの予約画面を開く
 *   (リンク自体は残してあるので、このファイルが読み込めない場合は従来どおり外部の予約ページが開く)
 * - 空き枠は /api/booking/slots、予約は /api/booking/create(Netlify Functions)を使う
 * - 予約APIが使えないときは、押されたリンクの外部予約ページを案内する
 * 入力値は、このタブ内の保存領域(sessionStorage)に置く。URLには載せない
 */
(function(){
  var API_SLOTS='/api/booking/slots';
  var API_CREATE='/api/booking/create';
  var EARLIEST_COUNT=3; // 上部「最短の候補」に出す件数
  var STORE_KEY='naus_recruit_lead';
  var EXTERNAL=/^https:\/\/calendar\.app\.google\//;
  var SOURCE=/^\/2(\/|$)/.test(location.pathname)?'recruit_2':'recruit_1';
  var TITLE='未経験エンジニア求人紹介(30分・オンライン)のご予約';
  // 日時を選ぶ画面の上に出す説明文
  var INTRO=['初めまして。nausの高谷と申します。','未経験からでも挑戦可能なエンジニアの求人をご紹介いたします。','お話しできますこと楽しみにしております！'];
  var WD=['日','月','火','水','木','金','土'];
  var JST=9*60*60*1000;
  var DAY=24*60*60*1000;

  var FIELDS=[
    {key:'last',label:'姓',type:'text',ac:'family-name'},
    {key:'first',label:'名',type:'text',ac:'given-name'},
    {key:'email',label:'メールアドレス',type:'email',ac:'email',full:true}
  ];

  var st={open:false,fallback:'',slots:[],mock:false,selected:null,from:'',weekStart:0,day:'',editing:false,notice:'',sending:false};
  var overlay,dialog,body,lastFocus=null,prevOverflow='';

  // ---- 日付の表示(利用者の端末の時刻設定に関係なく、日本時間で表示する) ----
  function jst(ms){var d=new Date(ms+JST);return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),w:d.getUTCDay(),h:d.getUTCHours(),mi:d.getUTCMinutes()};}
  function pad(n){return (n<10?'0':'')+n;}
  function hm(ms){var p=jst(ms);return p.h+':'+pad(p.mi);}
  function md(ms){var p=jst(ms);return p.m+'/'+p.d+'('+WD[p.w]+')';}
  function dayKey(ms){var p=jst(ms);return p.y+'-'+pad(p.m)+'-'+pad(p.d);}
  function midnight(ms){var p=jst(ms);return Date.UTC(p.y,p.m-1,p.d)-JST;}
  function monday(ms){var m=midnight(ms);var w=jst(m).w;return m-((w+6)%7)*DAY;}
  function slotLabel(s){return md(s.start)+' '+hm(s.start)+'〜'+hm(s.end);}

  // ---- 入力値の保存 ----
  function readLead(){try{return JSON.parse(sessionStorage.getItem(STORE_KEY)||'null')||{};}catch(e){return {};}}
  function writeLead(patch){
    try{
      var cur=readLead();
      for(var k in patch)cur[k]=patch[k];
      sessionStorage.setItem(STORE_KEY,JSON.stringify(cur));
    }catch(e){}
  }

  // 計測: GTMへ送るイベント(dataLayer)。個人情報(姓・名・メール)は載せない
  function track(event,params){
    try{
      var d={event:event,lp_type:SOURCE};
      if(st.mock)d.is_mock=true;
      if(params)for(var k in params)d[k]=params[k];
      (window.dataLayer=window.dataLayer||[]).push(d);
    }catch(e){}
  }

  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function clear(node){while(node.firstChild)node.removeChild(node.firstChild);}

  // ---- 画面の骨組み ----
  function build(){
    overlay=el('div','bk-overlay'+(SOURCE==='recruit_2'?' bk-theme-rose':''));
    overlay.hidden=true;
    dialog=el('div','bk-dialog');
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-labelledby','bk-title');
    dialog.tabIndex=-1;
    var head=el('div','bk-head');
    var title=el('h2','bk-title',TITLE);
    title.id='bk-title';
    var x=el('button','bk-close','×');
    x.type='button';
    x.setAttribute('aria-label','閉じる');
    x.addEventListener('click',close);
    head.appendChild(title);
    head.appendChild(x);
    body=el('div','bk-body');
    dialog.appendChild(head);
    dialog.appendChild(body);
    overlay.appendChild(dialog);
    overlay.addEventListener('click',function(e){if(e.target===overlay&&!st.sending)close();});
    document.body.appendChild(overlay);
    document.addEventListener('keydown',onKey);
  }

  function onKey(e){
    if(!st.open)return;
    if(e.key==='Escape'||e.key==='Esc'){if(!st.sending){e.preventDefault();close();}return;}
    if(e.key==='Tab'){
      var f=Array.prototype.filter.call(dialog.querySelectorAll('button,a[href],input,textarea,select'),function(n){return !n.disabled&&n.offsetParent!==null&&n.tabIndex!==-1;});
      if(!f.length)return;
      var first=f[0],last=f[f.length-1],a=document.activeElement;
      if(e.shiftKey&&(a===first||a===dialog)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&a===last){e.preventDefault();first.focus();}
    }
  }

  function open(fallback){
    if(!overlay)build();
    st.fallback=fallback||'';
    st.selected=null;st.from='';st.editing=false;st.notice='';st.sending=false;
    lastFocus=document.activeElement;
    prevOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    overlay.hidden=false;
    st.open=true;
    dialog.focus();
    track('booking_ui_open',{open_source:'click'});
    loadSlots();
  }
  // 画面が切り替わったら先頭に戻す
  function toTop(){body.scrollTop=0;}
  function close(){
    if(!st.open||st.sending)return; // 予約の送信中は閉じない(結果を必ず表示する)
    st.open=false;
    overlay.hidden=true;
    document.body.style.overflow=prevOverflow;
    if(lastFocus&&lastFocus.focus)lastFocus.focus();
  }

  // ---- 空き枠の取得 ----
  function fetchSlots(onReady){
    clear(body);
    body.appendChild(el('p','bk-status','空き状況を確認しています…'));
    fetch(API_SLOTS,{headers:{'Accept':'application/json'},cache:'no-store'})
      .then(function(r){if(!r.ok)throw new Error(String(r.status));return r.json();})
      .then(function(data){
        if(!st.open)return;
        st.mock=!!data.mock;
        st.slots=(data.slots||[]).map(function(s){return {start:Date.parse(s.start),end:Date.parse(s.end),iso:s.start};});
        if(!st.slots.length){renderEmpty();return;}
        st.weekStart=monday(st.slots[0].start);
        st.day=dayKey(st.slots[0].start);
        onReady();
      })
      .catch(function(){if(st.open)renderFallback('slots_unavailable');});
  }
  function loadSlots(){fetchSlots(renderSelect);}
  function loadSlotsKeepNotice(){
    var keep=st.notice;
    fetchSlots(function(){st.notice=keep;renderSelect();});
  }

  function mockBanner(){
    if(st.mock)body.appendChild(el('p','bk-mock','テスト表示: 仮の空き枠です。予約しても実際のカレンダーには登録されません。'));
  }
  function noticeBox(){
    if(st.notice){body.appendChild(el('p','bk-notice',st.notice));st.notice='';}
  }

  function fallbackLink(){
    var a=el('a','bk-primary','予約ページを開く');
    a.href=st.fallback||'#';
    a.target='_blank';
    a.rel='noopener';
    return a;
  }
  // 予約APIが使えないとき: 押されたリンクの外部予約ページを案内する
  function renderFallback(reason){
    track('booking_error',{error_type:reason||'unavailable'});
    clear(body);
    var box=el('div','bk-done');
    box.appendChild(el('p','bk-text','現在、この画面から予約を受け付けられません。お手数ですが、下のボタンから予約ページを開いてお申し込みください。'));
    box.appendChild(fallbackLink());
    body.appendChild(box);
  }
  function renderEmpty(){
    track('booking_error',{error_type:'no_slots'});
    clear(body);
    mockBanner();
    var box=el('div','bk-done');
    box.appendChild(el('p','bk-text','現在、ご予約いただける日時がありません。お手数ですが、下のボタンから予約ページをご確認ください。'));
    box.appendChild(fallbackLink());
    body.appendChild(box);
  }

  // ---- 日時を選ぶ ----
  function pick(slot,from){
    track('slot_select',{slot_source:from,calendar_view:'week'});
    st.selected=slot;
    st.from=from;
    renderConfirm();
  }

  function renderSelect(){
    clear(body);
    mockBanner();
    noticeBox();
    // 説明文
    var intro=el('p','bk-intro');
    INTRO.forEach(function(t,i){if(i)intro.appendChild(document.createElement('br'));intro.appendChild(document.createTextNode(t));});
    body.appendChild(intro);
    // 上部: 最短の候補(EARLIEST_COUNT件)
    var sec1=el('section','bk-sec');
    sec1.appendChild(el('h3','bk-sec-title','最短の候補'));
    var list=el('div','bk-earliest');
    st.slots.slice(0,EARLIEST_COUNT).forEach(function(s){
      var b=el('button','bk-early-btn');
      b.type='button';
      b.appendChild(el('span',null,slotLabel(s)));
      b.appendChild(el('span',null,'›'));
      b.setAttribute('aria-label',slotLabel(s)+'を選ぶ');
      b.addEventListener('click',function(){pick(s,'earliest');});
      list.appendChild(b);
    });
    sec1.appendChild(list);
    body.appendChild(sec1);
    // 下部: カレンダー
    var sec2=el('section','bk-sec');
    sec2.appendChild(el('h3','bk-sec-title','カレンダーから選ぶ'));
    renderWeek(sec2);
    body.appendChild(sec2);
    toTop();
  }

  function slotsOfDay(key){return st.slots.filter(function(s){return dayKey(s.start)===key;});}

  // 5日分(月〜金)の週表示(PC・スマホ共通)
  function renderWeek(sec){
    var firstWeek=monday(Date.now());
    var lastWeek=monday(st.slots[st.slots.length-1].start);
    var nav=el('div','bk-weeknav');
    var prev=el('button','bk-navbtn','‹ 前の週');prev.type='button';
    var next=el('button','bk-navbtn','次の週 ›');next.type='button';
    var fri=st.weekStart+4*DAY;
    var label=el('span','bk-weeklabel',md(st.weekStart)+' 〜 '+md(fri));
    prev.disabled=st.weekStart<=firstWeek;
    next.disabled=st.weekStart>=lastWeek;
    prev.addEventListener('click',function(){st.weekStart-=7*DAY;renderSelect();});
    next.addEventListener('click',function(){st.weekStart+=7*DAY;renderSelect();});
    nav.appendChild(prev);nav.appendChild(label);nav.appendChild(next);
    sec.appendChild(nav);

    var grid=el('div','bk-grid');
    grid.setAttribute('role','group');
    grid.setAttribute('aria-label',md(st.weekStart)+'〜'+md(fri)+'の空き時間');
    var cols=[],times={};
    var corner=el('div','bk-gh bk-gt-head');
    corner.setAttribute('aria-hidden','true');
    grid.appendChild(corner);
    for(var i=0;i<5;i++){
      var dms=st.weekStart+i*DAY;
      var ds=slotsOfDay(dayKey(dms));
      cols.push({ms:dms,slots:ds});
      ds.forEach(function(s){times[hm(s.start)]=jst(s.start).h*60+jst(s.start).mi;});
      // 見出し: 日付と曜日を分けて置く(幅が狭いときは曜日の前で折り返す)
      var h=el('div','bk-gh'+(ds.length?'':' is-off'));
      var label=md(dms),cut=label.indexOf('(');
      h.appendChild(el('span',null,label.slice(0,cut)));
      h.appendChild(el('span',null,label.slice(cut)));
      grid.appendChild(h);
    }
    // 行: この週に1つでも空きがある時刻(無い週は「空きがありません」)
    var rows=Object.keys(times).sort(function(a,b){return times[a]-times[b];});
    if(!rows.length){
      var none=el('p','bk-status','この週は空きがありません。');
      none.style.gridColumn='1/-1';
      grid.appendChild(none);
    }
    // 行: 左端に時刻、各日のマスは ○(予約できる)/×(予約できない)
    rows.forEach(function(t){
      grid.appendChild(el('div','bk-gt',t));
      cols.forEach(function(c){
        var s=null;
        c.slots.forEach(function(x){if(hm(x.start)===t)s=x;});
        if(s){
          var b=el('button','bk-slot','○');
          b.type='button';
          b.setAttribute('aria-label',slotLabel(s)+'を選ぶ');
          b.addEventListener('click',function(){pick(s,'calendar');});
          grid.appendChild(b);
        }else{
          var c2=el('div','bk-cell');
          var mark=el('span',null,'×');
          mark.setAttribute('aria-hidden','true');
          c2.appendChild(mark);
          c2.appendChild(el('span','bk-sr',md(c.ms)+' '+t+' 予約できません'));
          grid.appendChild(c2);
        }
      });
    });
    sec.appendChild(grid);
  }

  // ---- 確認と予約 ----
  var ERR={required:'入力してください',invalid_email:'メールアドレスの形式をご確認ください',too_long:'文字数が多すぎます'};
  function checkValue(key,v){
    if(!v)return 'required';
    if(key==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))return 'invalid_email';
    return '';
  }

  function renderConfirm(){
    clear(body);
    mockBanner();
    noticeBox();
    var s=st.selected;
    var when=el('p','bk-when');
    when.appendChild(el('small',null,'ご予約日時'));
    when.appendChild(document.createTextNode(slotLabel(s)));
    body.appendChild(when);

    var lead=readLead();
    var complete=FIELDS.every(function(f){return !checkValue(f.key,(lead[f.key]||'').trim());});
    var inputs={};

    if(complete&&!st.editing){
      // 入力済み: 内容を表示し、直したいときだけ編集に切り替える
      var dl=el('dl','bk-info');
      FIELDS.forEach(function(f){dl.appendChild(el('dt',null,f.label));dl.appendChild(el('dd',null,lead[f.key]));});
      body.appendChild(dl);
      var ed=el('button','bk-edit','入力内容を修正する');
      ed.type='button';
      ed.addEventListener('click',function(){st.editing=true;renderConfirm();});
      body.appendChild(ed);
    }

    var box=el('div','bk-fields');
    FIELDS.forEach(function(f){
      if(complete&&!st.editing)return;
      var wrap=el('div',f.full?'bk-field-full':null);
      var id='bk-f-'+f.key;
      var lab=el('label','bk-label',f.label);
      lab.setAttribute('for',id);
      lab.appendChild(el('em',null,'必須'));
      var inp=el('input','bk-input');
      inp.id=id;inp.type=f.type;inp.autocomplete=f.ac;inp.required=true;
      inp.value=lead[f.key]||'';
      inp.addEventListener('input',function(){var p={};p[f.key]=inp.value.trim();writeLead(p);setErr(inp,'');});
      var err=el('p','bk-err');err.id=id+'-err';err.hidden=true;
      wrap.appendChild(lab);wrap.appendChild(inp);wrap.appendChild(err);
      box.appendChild(wrap);
      inputs[f.key]=inp;
    });
    // スパム対策の隠し欄(人には見えない)
    var hp=el('div','bk-hp');
    hp.setAttribute('aria-hidden','true');
    var hpi=el('input');hpi.type='text';hpi.name='website';hpi.tabIndex=-1;hpi.autocomplete='off';
    hp.appendChild(hpi);
    box.appendChild(hp);
    body.appendChild(box);

    var act=el('div','bk-actions');
    var go=el('button','bk-primary','この日時で予約する');
    go.type='button';
    var back=el('button','bk-secondary','‹ 日時を選び直す');
    back.type='button';
    back.addEventListener('click',function(){st.selected=null;renderSelect();});
    go.addEventListener('click',function(){submit(inputs,hpi,go,back);});
    act.appendChild(go);act.appendChild(back);
    body.appendChild(act);
    toTop();
  }

  function setErr(inp,code){
    var err=document.getElementById(inp.id+'-err');
    if(!err)return;
    err.textContent=code?(ERR[code]||ERR.required):'';
    err.hidden=!code;
    if(code){inp.setAttribute('aria-invalid','true');inp.setAttribute('aria-describedby',err.id);}
    else{inp.removeAttribute('aria-invalid');inp.removeAttribute('aria-describedby');}
  }

  function submit(inputs,hpi,go,back){
    if(st.sending)return;
    var lead=readLead();
    var data={source:SOURCE,start:st.selected.iso,website:hpi.value};
    var first=null;
    FIELDS.forEach(function(f){
      var inp=inputs[f.key];
      var v=inp?inp.value.trim():String(lead[f.key]||'').trim();
      data[f.key]=v;
      if(inp){var c=checkValue(f.key,v);setErr(inp,c);if(c&&!first)first=inp;}
    });
    if(first){first.focus();return;}
    var patch={};FIELDS.forEach(function(f){patch[f.key]=data[f.key];});
    writeLead(patch);

    st.sending=true;
    go.disabled=true;back.disabled=true;
    go.textContent='予約しています…';
    fetch(API_CREATE,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(data)})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(b){return {status:r.status,body:b};});})
      .then(function(res){
        st.sending=false;
        if(!st.open)return;
        if(res.status===200&&res.body.ok){track('booking_complete',{slot_source:st.from});renderDone(res.body,data.email);return;}
        if(res.status===409||(res.status===400&&res.body.fields&&res.body.fields.start)){
          track('booking_error',{error_type:'slot_unavailable'});
          st.notice='この枠は選択できなくなりました。お手数ですが、別の日時をお選びください。';
          st.selected=null;
          loadSlotsKeepNotice();
          return;
        }
        if(res.status===400&&res.body.fields){
          track('booking_error',{error_type:'validation'});
          // 入力の不備: 該当欄を編集できる状態にして知らせる
          st.editing=true;
          renderConfirm();
          Object.keys(res.body.fields).forEach(function(k){
            var code=res.body.fields[k];
            var inp=document.getElementById('bk-f-'+k);
            if(!inp)return;
            setErr(inp,code==='invalid'?(k==='email'?'invalid_email':'required'):code);
          });
          return;
        }
        if(res.status===429){
          track('booking_error',{error_type:'rate_limited'});
          go.disabled=false;back.disabled=false;go.textContent='この日時で予約する';
          var n=el('p','bk-notice','短時間に操作が続いたため、受け付けられませんでした。少し時間をおいて、もう一度お試しください。');
          body.insertBefore(n,body.firstChild);
          toTop();
          return;
        }
        renderFallback();
      })
      .catch(function(){st.sending=false;if(st.open)renderFallback('network');});
  }

  function renderDone(res,email){
    clear(body);
    mockBanner();
    var box=el('div','bk-done');
    box.appendChild(el('span','bk-check','✓'));
    box.appendChild(el('h3','bk-done-title','ご予約が完了しました'));
    var when=el('p','bk-when');
    when.appendChild(el('small',null,'ご予約詳細'));
    when.appendChild(document.createTextNode(slotLabel({start:Date.parse(res.start),end:Date.parse(res.end)})));
    // 日時の下に、Google Meetの案内を出す
    if(res.meetUrl){
      var mp=el('span','bk-meet');
      mp.appendChild(document.createTextNode('Google Meet: '));
      var a=el('a',null,res.meetUrl);
      a.href=res.meetUrl;a.target='_blank';a.rel='noopener';
      mp.appendChild(a);
      when.appendChild(mp);
    }else{
      when.appendChild(el('span','bk-meet','Google MeetのURLは、招待メールでお知らせします。'));
    }
    box.appendChild(when);
    var msg=el('p','bk-text',email+' 宛てに、Googleカレンダーの招待メールをお送りしました。');
    msg.appendChild(document.createElement('br'));
    msg.appendChild(document.createTextNode('当日は招待メールのGoogle Meetからご参加ください。'));
    box.appendChild(msg);
    var c=el('button','bk-primary','閉じる');
    c.type='button';
    c.addEventListener('click',close);
    box.appendChild(c);
    body.appendChild(box);
    toTop();
  }

  // ---- 外部予約リンクを、この予約画面を開く動作に切り替える ----
  document.addEventListener('click',function(e){
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
    if(!a||!EXTERNAL.test(a.href))return;
    if(a.closest('.bk-overlay'))return; // 予約画面の中の「予約ページを開く」は外部ページをそのまま開く
    e.preventDefault();
    var p={};
    var loc=a.getAttribute('data-cta-location');
    if(loc)p.cta_location=loc;
    track('cta_click',p);
    open(a.href);
  });
})();
