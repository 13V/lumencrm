'use client';

import {useState} from 'react';
import {Plus} from 'lucide-react';
import {Button,Field} from './ui';

type Product={id:string;name:string;kind:string;price:number;summary:string;included:string[];active:boolean};
type Props={products:Product[];busy:boolean;onSave:(input:object)=>Promise<unknown>};

function ProductForm({product,busy,onSave,onCancel}:{product?:Product;busy:boolean;onSave:Props['onSave'];onCancel?:()=>void}) {
  const [error,setError]=useState('');
  return <form className="form-stack detail-section" aria-label={product?`Edit ${product.name}`:'Add product'} onSubmit={async event=>{
    event.preventDefault();setError('');const form=event.currentTarget,f=new FormData(form),included=String(f.get('included')).split('\n').map(s=>s.trim()).filter(Boolean);
    if(included.length>50||included.some(s=>s.length>1000)){setError('Use up to 50 included lines, each under 1,000 characters.');return;}
    const saved=await onSave({action:'product',...(product?{id:product.id}:{}),name:String(f.get('name')).trim(),kind:String(f.get('kind')),price:Number(f.get('price')),summary:String(f.get('summary')).trim(),included,active:f.get('active')==='on'});
    if(saved&&!product){form.reset();onCancel?.();}
  }}>
    <div className="form-row"><Field label="Product name"><input name="name" defaultValue={product?.name??''} maxLength={200} required/></Field><Field label="Billing"><select name="kind" aria-label="Billing" defaultValue={product?.kind??'once'}><option value="once">One-off</option><option value="monthly">Monthly</option></select></Field></div>
    <Field label="Price (AUD)"><input name="price" type="number" inputMode="decimal" min="0" max="99999999" step="0.01" defaultValue={product?.price??''} required/></Field>
    <Field label="Summary"><textarea name="summary" defaultValue={product?.summary??''} maxLength={2000}/></Field>
    <Field label="What’s included"><textarea name="included" defaultValue={product?.included?.join('\n')??''} rows={4} placeholder="One item per line"/></Field>
    <label className="permission-confirm"><input name="active" type="checkbox" defaultChecked={product?.active??true}/>Available for new quotes</label>
    <p className="text-small muted">Existing quotes keep their agreed price and inclusions.</p>
    {error&&<p role="alert" className="error-text">{error}</p>}<div className="row"><Button disabled={busy}>{product?'Save product':'Add product'}</Button>{onCancel&&<Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}</div>
  </form>;
}

export function ProductEditor({products,busy,onSave}:Props) {
  const [adding,setAdding]=useState(false);
  return <section className="card"><div className="section-title"><h2>Price list</h2><Button type="button" variant="outline" size="small" disabled={busy||adding} onClick={()=>setAdding(true)}><Plus size={15}/>Add product</Button></div><p className="muted">Manage the services, prices and inclusions offered in new quotes.</p>{adding&&<ProductForm busy={busy} onSave={onSave} onCancel={()=>setAdding(false)}/>}<div className="product-settings-list">{products.map(product=><details key={product.id} className="detail-section"><summary className="spread"><span>{product.name}<small className="muted">{product.kind==='monthly'?' · Monthly':' · One-off'}{!product.active?' · Inactive':''}</small></span><strong>{new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(product.price)}</strong></summary><ProductForm key={JSON.stringify(product)} product={product} busy={busy} onSave={onSave}/></details>)}</div>{!products.length&&!adding&&<p className="muted">Add your first service to start building quotes.</p>}</section>;
}
