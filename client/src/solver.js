// ── SOLVER ───────────────────────────────────────────────────────────────────
// ── LINEAR PROGRAMMING (Big-M Simplex) ──────────────────────────────────────
function lpSolve({c,A_ub,b_ub,A_eq,b_eq,lb,ub,maxIter=8000}){
  const n=c.length,BigM=1e8,EPS=1e-9;
  const lbA=lb||Array(n).fill(0);
  const ubA=ub||Array(n).fill(100);
  const range=ubA.map((u,i)=>Math.max(0,u-lbA[i]));
  const rows_ub=A_ub?A_ub.length:0,rows_eq=A_eq?A_eq.length:0,rows_box=n;
  const m=rows_ub+rows_eq+rows_box;
  const nSlkUb=rows_ub,nSlkBox=n,nArt=rows_eq;
  const nT=n+nSlkUb+nSlkBox+nArt;
  const T=Array.from({length:m+1},()=>new Float64Array(nT+1));
  for(let j=0;j<n;j++) T[m][j]=c[j];
  for(let j=0;j<nArt;j++) T[m][n+nSlkUb+nSlkBox+j]=BigM;
  const basis=new Int32Array(m);
  for(let i=0;i<rows_ub;i++){
    for(let j=0;j<n;j++) T[i][j]=A_ub[i][j];
    let rhs=b_ub[i];for(let k=0;k<n;k++) rhs-=A_ub[i][k]*lbA[k];
    if(rhs<0){for(let j=0;j<n;j++) T[i][j]=-T[i][j];rhs=-rhs;T[i][n+i]=-1;}
    else T[i][n+i]=1;
    T[i][nT]=rhs;basis[i]=n+i;
  }
  for(let i=0;i<rows_eq;i++){
    const r=rows_ub+i;
    for(let j=0;j<n;j++) T[r][j]=A_eq[i][j];
    let rhs=b_eq[i];for(let k=0;k<n;k++) rhs-=A_eq[i][k]*lbA[k];
    T[r][n+nSlkUb+nSlkBox+i]=1;T[r][nT]=rhs;basis[r]=n+nSlkUb+nSlkBox+i;
    for(let j=0;j<=nT;j++) T[m][j]-=BigM*T[r][j];
  }
  for(let i=0;i<n;i++){
    const r=rows_ub+rows_eq+i;
    T[r][i]=1;T[r][n+nSlkUb+i]=1;T[r][nT]=range[i];basis[r]=n+nSlkUb+i;
  }
  function pivot(row,col){
    const pv=T[row][col];
    for(let j=0;j<=nT;j++) T[row][j]/=pv;
    for(let i=0;i<=m;i++){if(i===row)continue;const f=T[i][col];if(Math.abs(f)<EPS)continue;for(let j=0;j<=nT;j++) T[i][j]-=f*T[row][j];}
    basis[row]=col;
  }
  let iters=0;
  while(iters++<maxIter){
    let col=-1,minC=-EPS;
    for(let j=0;j<nT;j++){if(T[m][j]<minC){minC=T[m][j];col=j;}}
    if(col===-1)break;
    let row=-1,minR=Infinity;
    for(let i=0;i<m;i++){if(T[i][col]>EPS){const r=T[i][nT]/T[i][col];if(r<minR-EPS){minR=r;row=i;}}}
    if(row===-1)return{feasible:false,x:null,cost:Infinity,iters};
    pivot(row,col);
  }
  const x=new Float64Array(n);
  for(let i=0;i<m;i++){const b=basis[i];if(b<n)x[b]=T[i][nT];}
  let feasible=true;
  outer:for(let j=n+nSlkUb+nSlkBox;j<nT;j++){for(let i=0;i<m;i++){if(basis[i]===j&&T[i][nT]>1e-4){feasible=false;break outer;}}}
  const xF=Array.from(x).map((xi,i)=>xi+lbA[i]);
  return{feasible,x:xF,cost:c.reduce((s,ci,i)=>s+ci*xF[i],0),iters};
}
function solveLeastCostLP(ingrs,reqs,inclLimits){
  const lim=inclLimits||{};
  const NUTS=['cp','me','fat','fibre','ca','p','lys','met'];
  const n=ingrs.length;if(!n)return null;
  const c=ingrs.map(i=>i.price/100);
  const lb=ingrs.map(i=>parseFloat(lim[i.id]?.min??0));
  const ub=ingrs.map(i=>Math.min(parseFloat(lim[i.id]?.max??100),100));
  const A_eq=[ingrs.map(()=>1)],b_eq=[100];
  const A_ub=[],b_ub=[];
  NUTS.forEach(nut=>{
    const req=reqs[nut];if(!req)return;
    const vals=ingrs.map(i=>(parseFloat(i[nut])||0)/100);
    if(req[0]>0){A_ub.push(vals.map(v=>-v));b_ub.push(-req[0]);}
    if(req[1]<9999){A_ub.push(vals);b_ub.push(req[1]);}
  });
  const res=lpSolve({c,A_ub,b_ub,A_eq,b_eq,lb,ub});
  if(!res.feasible||!res.x)return null;
  const formula={};
  res.x.forEach((pct,i)=>{if(pct>0.05)formula[ingrs[i].id]=pct;});
  const tot=Object.values(formula).reduce((s,v)=>s+v,0);
  if(tot<1)return null;
  const sc=100/tot;Object.keys(formula).forEach(k=>formula[k]*=sc);
  const raw=Object.entries(formula);
  const diff=100-raw.reduce((s,[,v])=>s+v,0);
  if(raw.length&&Math.abs(diff)>0.001){const lg=raw.reduce((a,b)=>b[1]>a[1]?b:a)[0];formula[lg]+=diff;}
  return{formula,costPerKg:res.cost/100,iters:res.iters};
}
function solveLeastCost(ingrs,reqs){
  if(!ingrs.length)return null;
  let formula={},remaining=100;
  const fixed={premix:0.25,salt:0.3};
  ingrs.forEach(i=>{if(fixed[i.id]!==undefined){formula[i.id]=fixed[i.id];remaining-=fixed[i.id];}});
  if(reqs.ca&&reqs.ca[0]>2){
    const lim=ingrs.find(i=>i.id==='limestone');if(lim){formula['limestone']=8;remaining-=8;}
    const dc=ingrs.find(i=>i.id==='dcp');if(dc&&!formula['dcp']){formula['dcp']=1.5;remaining-=1.5;}
  } else {
    const lim=ingrs.find(i=>i.id==='limestone');if(lim&&!formula['limestone']){formula['limestone']=1.5;remaining-=1.5;}
    const dc=ingrs.find(i=>i.id==='dcp');if(dc&&!formula['dcp']){formula['dcp']=1.5;remaining-=1.5;}
  }
  const variable=ingrs.filter(i=>formula[i.id]===undefined);
  const protSrcs=variable.filter(i=>i.cp>=30);
  const engSrcs=variable.filter(i=>i.cp<30&&i.me>=2000);
  const roughSrcs=variable.filter(i=>i.fibre>=15);
  const targetCP=(reqs.cp[0]+reqs.cp[1])/2;
  const curCP=Object.entries(formula).reduce((s,[id,pct])=>{const i=ingrs.find(x=>x.id===id);return i?s+(pct/100)*i.cp:s;},0);
  const neededCP=targetCP-curCP;
  let remVar=remaining;
  if(protSrcs.length>0){
    protSrcs.sort((a,b)=>(b.cp/b.price)-(a.cp/a.price));
    const avgCP=protSrcs.reduce((s,i)=>s+i.cp,0)/protSrcs.length;
    let pp=Math.min(remVar*0.45,Math.max(5,(neededCP/(avgCP/100))*100));
    pp=Math.min(40,Math.max(5,pp));
    if(protSrcs.length>=2){formula[protSrcs[0].id]=pp*0.65;formula[protSrcs[1].id]=pp*0.35;}
    else{formula[protSrcs[0].id]=pp;}
    remVar-=pp;
  }
  if(reqs.fibre[1]>=15&&roughSrcs.length>0){
    roughSrcs.sort((a,b)=>a.price-b.price);
    const rp=Math.min(remVar*0.3,20);formula[roughSrcs[0].id]=rp;remVar-=rp;
  }
  if(engSrcs.length>0){
    engSrcs.sort((a,b)=>(b.me/b.price)-(a.me/a.price));
    if(engSrcs[1]&&remVar>5){formula[engSrcs[0].id]=remVar*0.75;formula[engSrcs[1].id]=remVar*0.25;}
    else if(engSrcs[0]){formula[engSrcs[0].id]=remVar;}
  }
  const total=Object.values(formula).reduce((s,v)=>s+v,0);
  if(!total)return null;
  Object.keys(formula).forEach(k=>{formula[k]=(formula[k]/total)*100;});
  Object.keys(formula).forEach(k=>{if(formula[k]<0.05)delete formula[k];});
  return formula;
}
function calcNutrients(formula,ingrs){
  let cp=0,me=0,fat=0,fibre=0,ca=0,p=0,lys=0,met=0;
  Object.entries(formula).forEach(([id,pct])=>{
    const i=ingrs.find(x=>x.id===id);if(!i)return;const f=pct/100;
    cp+=f*i.cp;me+=f*i.me;fat+=f*i.fat;fibre+=f*i.fibre;
    ca+=f*i.ca;p+=f*i.p;lys+=f*(i.lys||0);met+=f*(i.met||0);
  });
  return{cp,me,fat,fibre,ca,p,lys,met};
}
function calcCost(formula,ingrs){
  return Object.entries(formula).reduce((s,[id,pct])=>{const i=ingrs.find(x=>x.id===id);return i?s+(pct/100)*i.price:s;},0);
}


export { lpSolve, solveLeastCostLP, solveLeastCost, calcNutrients, calcCost };
