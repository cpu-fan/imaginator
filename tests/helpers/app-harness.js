const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
class Element {
 constructor(tag,attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.children=[];this.parentElement=null;this.listeners={};this.value=attrs.value||'';this.files=[];this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this._text='';this.classes=new Set((attrs.class||'').split(/ +/).filter(Boolean));this.classList={toggle:(name,value)=>value?this.classes.add(name):this.classes.delete(name),contains:name=>this.classes.has(name),add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)};}
 get className(){return [...this.classes].join(' ');}set className(value){this.classes=new Set(String(value).split(/ +/).filter(Boolean));}
 get id(){return this.attrs.id||'';}get type(){return this.attrs.type||'';}set type(value){this.attrs.type=value;}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set textContent(value){this._text=String(value);this.children=[];}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}appendChild(node){this.append(node);return node;}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}removeAttribute(key){delete this.attrs[key];delete this[key];}setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return this.attrs[key]??null;}focus(){}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 async fire(type){for(const fn of this.listeners[type]||[])await fn({target:this,preventDefault(){},key:''});}
 matches(selector){if(selector.startsWith('.'))return this.classes.has(selector.slice(1));if(selector.startsWith('#'))return this.id===selector.slice(1);const m=selector.match(/^([a-z]+)(?:\[([a-z-]+)=([^\]]+)\])?$/);return !!m&&this.tagName.toLowerCase()===m[1]&&(!m[2]||this.getAttribute(m[2])===m[3].replace(/['"]/g,''));}
 querySelectorAll(selector){const result=[];const choices=selector.split(',').map(s=>s.trim());for(const child of this.children){if(choices.some(s=>child.matches(s)))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentElement;}return null;}
}
function parseTemplate(html){
 const root=new Element('document'),stack=[root];
 for(const match of html.matchAll(/<\/?([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi)){
  if(match[3]){stack.at(-1)._text+=match[3];continue;}
  const tag=match[1].toLowerCase();if(match[0].startsWith('</')){while(stack.length>1){if(stack.pop().tagName.toLowerCase()===tag)break;}continue;}
  const attrs={};for(const a of match[2].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/gi))attrs[a[1]]=a[2]??a[3]??a[4]??'';
  const node=new Element(tag,attrs);stack.at(-1).append(node);if(!['input','br','hr','meta','link','img'].includes(tag))stack.push(node);
 }
 for(const select of root.querySelectorAll('select')){const options=select.querySelectorAll('option');select.value=(options.find(o=>'selected'in o.attrs)||options[0])?.attrs.value||'';}
 return root;
}
function createAppHarness(overrides={}){
 const root=parseTemplate(fs.readFileSync(path.join(__dirname,'../../index.template.html'),'utf8'));
 const nodes=new Map();const all=(node)=>{if(node.id)nodes.set(node.id,node);node.children.forEach(all);};all(root);
 const activeUrls=new Map(),revokedUrls=new Set();let urlCount=0,pngCount=0;const listeners={};
 const faults={...overrides.faults};
 const url={createObjectURL(blob){urlCount++;if(faults.urlAt===urlCount)throw new Error('URL allocation failed');const name='blob:test-'+urlCount;activeUrls.set(name,blob);return name;},revokeObjectURL(name){revokedUrls.add(name);activeUrls.delete(name);}};
 function canvas(){const c=new Element('canvas');c.width=0;c.height=0;let image;const context={fillRect(){},drawImage(img){image=img.image;},getImageData(){return {data:image.pixels};},putImageData(data){image={width:data.width,height:data.height,pixels:data.data};}};c.getContext=()=>context;c.toBlob=(callback)=>{pngCount++;if(faults.throwAt===pngCount)throw new RangeError('Blob allocation failed');if(faults.nullAt===pngCount){callback(null);return;}const blob=new Blob([Uint8Array.of(137,80,78,71,13,10,26,10)],{type:'image/png'});blob.image=image;callback(blob);};return c;}
 class Image {set src(url){const file=activeUrls.get(url);this.image=file.image;if(this.image){this.naturalWidth=this.image.width;this.naturalHeight=this.image.height;queueMicrotask(()=>this.onload());}else queueMicrotask(()=>this.onerror());}}
 class ImageData {constructor(data,width,height){this.data=data;this.width=width;this.height=height;}}
 const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:s=>root.querySelectorAll(s),createElement:tag=>tag==='canvas'?canvas():new Element(tag)};
 const context=vm.createContext({document,window:{addEventListener(type,fn){(listeners[type]??=[]).push(fn);}},crypto:webcrypto,File,Blob,Image,ImageData,URL:url,TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,queueMicrotask,console,...overrides.globals});
 for(const name of ['file-parts.js','vault-core.js','image-codec.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../..',name),'utf8'),context);
 if(overrides.vaultCore)context.VaultCore=overrides.vaultCore(context.VaultCore);
 if(overrides.imageCodec)context.ImageCodec=overrides.imageCodec(context.ImageCodec);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8'),context);
 const dispatch=async(id,type)=>{const node=nodes.get(id);if(!node)throw new Error('Missing UI control: '+id);await node.fire(type);};
 return {nodes,context,faults,activeUrls,revokedUrls,
  async setFiles(id,files){nodes.get(id).files=files;await dispatch(id,'change');},
  async setValue(id,value,type='input'){const node=nodes.get(id);if(!node)throw new Error('Missing UI control: '+id);node.value=String(value);await dispatch(id,type);},dispatch,
  submit:mode=>dispatch('panel-'+mode,'submit'),
  entries(mode){const form=nodes.get('panel-'+mode);return form.querySelectorAll('.download-link').filter(a=>a.href).map(a=>({name:a.download,blob:activeUrls.get(a.href)}));},
  status:mode=>nodes.get('panel-'+mode).querySelector('.form-status').textContent,
  hasResult:mode=>!nodes.get('panel-'+mode).querySelector('.result').hidden,
  controlsDisabled:()=>root.querySelectorAll('input, button, select').every(n=>n.disabled),
  unload(){for(const fn of listeners.beforeunload||[])fn();}
 };
}
module.exports={createAppHarness};
