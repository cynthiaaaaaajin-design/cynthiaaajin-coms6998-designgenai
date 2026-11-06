export const currencies={USD:2,EUR:2,CNY:2,GBP:2,JPY:0,CAD:2,AUD:2,CHF:2,KRW:0,INR:2,SGD:2,HKD:2,KWD:3} as const;
export type Currency=keyof typeof currencies;
export type Allocation={user_id:string;amount:number};
export type Expense={id:string;description:string;currency:Currency;amount:number;payer_id:string;allocations:Allocation[];category:string;expense_date:string;note:string;created_by:string;settlement_id:string|null};
export type Transfer={from:string;to:string;amount:number;currency:Currency};
export function minor(value:string,currency:Currency){
 const digits=currencies[currency];if(digits===undefined||typeof value!=='string'||!new RegExp(`^\\d{1,10}(?:\\.\\d{1,${Math.max(digits,1)}})?$`).test(value)||digits===0&&value.includes('.'))throw Error('Use a valid amount for this currency.');
 const [whole,fraction='']=value.split('.');if(fraction.length>digits)throw Error('Too many decimal places.');
 const n=Number(BigInt(whole)*BigInt(10)**BigInt(digits)+BigInt(fraction.padEnd(digits,'0')||'0'));if(!Number.isSafeInteger(n)||n>100000000000)throw Error('Amount is too large.');return n;
}
export function money(value:number,currency:Currency){return new Intl.NumberFormat('en-US',{style:'currency',currency,minimumFractionDigits:currencies[currency]}).format(value/10**currencies[currency]);}
export function allocate(amount:number,method:'equal'|'custom'|'percentage',participants:{user_id:string;value?:string}[],currency:Currency):Allocation[]{
 if(!Number.isSafeInteger(amount)||amount<=0||!participants.length||participants.length>100||new Set(participants.map(p=>p.user_id)).size!==participants.length)throw Error('Select distinct participants and a positive amount.');
 const sorted=[...participants].sort((a,b)=>a.user_id.localeCompare(b.user_id));
 if(method==='custom'){const result=sorted.map(p=>({user_id:p.user_id,amount:minor(p.value??'',currency)}));if(result.reduce((s,a)=>s+a.amount,0)!==amount)throw Error('Custom shares must equal the total.');return result;}
 const weights=sorted.map(p=>method==='equal'?1:minor(p.value??'','USD'));
 const total=weights.reduce((s,n)=>s+n,0);if(method==='percentage'&&total!==10000||!total)throw Error('Percentages must total 100.00.');
 // Largest remainder, tie broken by stable participant ID. All intermediate products are exact bigint.
 const raw=weights.map((n,i)=>{const product=BigInt(amount)*BigInt(n);return {user_id:sorted[i].user_id,amount:Number(product/BigInt(total)),remainder:product%BigInt(total)};});
 const remaining=amount-raw.reduce((s,a)=>s+a.amount,0);
 const priority=[...raw].sort((a,b)=>a.remainder===b.remainder?a.user_id.localeCompare(b.user_id):a.remainder>b.remainder?-1:1);
 for(let i=0;i<remaining;i++)priority[i].amount++;
 return raw.map(({user_id,amount})=>({user_id,amount}));
}
export function settlement(expenses:Pick<Expense,'amount'|'payer_id'|'allocations'|'currency'>[]){
 const ledgers:Partial<Record<Currency,Record<string,number>>>={};
 for(const e of expenses){if(!Number.isSafeInteger(e.amount)||e.amount<=0||e.allocations.some(a=>!Number.isSafeInteger(a.amount)||a.amount<0)||e.allocations.reduce((s,a)=>s+a.amount,0)!==e.amount)throw Error('Expense allocations do not balance.');const ledger=ledgers[e.currency]??={};ledger[e.payer_id]=(ledger[e.payer_id]??0)+e.amount;for(const a of e.allocations)ledger[a.user_id]=(ledger[a.user_id]??0)-a.amount;}
 const transfers:Transfer[]=[];
 for(const currency of Object.keys(ledgers).sort() as Currency[]){const balances=ledgers[currency]!;if(Object.values(balances).reduce((s,n)=>s+n,0)!==0)throw Error('Ledger does not balance.');const creditors=Object.keys(balances).sort().filter(id=>balances[id]>0).map(id=>({id,n:balances[id]})),debtors=Object.keys(balances).sort().filter(id=>balances[id]<0).map(id=>({id,n:-balances[id]}));let i=0,j=0;while(i<debtors.length&&j<creditors.length){const amount=Math.min(debtors[i].n,creditors[j].n);transfers.push({from:debtors[i].id,to:creditors[j].id,amount,currency});debtors[i].n-=amount;creditors[j].n-=amount;if(!debtors[i].n)i++;if(!creditors[j].n)j++;}if(i<debtors.length||j<creditors.length)throw Error('Unsettled residual.');}
 return {ledgers,transfers};
}
