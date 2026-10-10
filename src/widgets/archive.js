// Bounded ZIP reader for ordinary .rmskin / .zip packages. No extraction to disk.
// Only INI/INC and raster images are retained; executable payloads never run.
export const MAX_ARCHIVE=32*1024*1024;
export function safePath(name){const n=name.replace(/\\/g,'/');if(n.startsWith('/')||/^[a-z]:/i.test(n)||n.includes('\0'))throw Error('Absolute paths are not supported');const p=[];for(const s of n.split('/')){if(!s||s==='.')continue;if(s==='..'){if(!p.length)throw Error('Path escapes the package');p.pop();}else p.push(s);}return p.join('/');}
export function decodeText(bytes){if(bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le').decode(bytes);if(bytes[0]===254&&bytes[1]===255)return new TextDecoder('utf-16be').decode(bytes);return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/,'');}
export function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
async function inflate(bytes,max){const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();const chunks=[];let n=0;try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>max)throw Error('Expanded skin exceeds its size limit');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const out=new Uint8Array(n);let at=0;for(const b of chunks){out.set(b,at);at+=b.length;}return out;}
export async function readArchive(buffer){
  const bytes=new Uint8Array(buffer);if(bytes.length>MAX_ARCHIVE)throw Error('Choose a package smaller than 32 MB');const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  // Rainmeter appends a short footer after an otherwise standard ZIP.
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-66000);i--)if(d.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw Error('This is not a supported ZIP/RMSKIN package');
  const count=d.getUint16(end+10,true),size=d.getUint32(end+12,true);let pos=d.getUint32(end+16,true);
  if(d.getUint16(end+4,true)||d.getUint16(end+6,true)||count===65535||count>2000||pos+size>end)throw Error('Split, ZIP64 or oversized packages are not supported');
  const directoryEnd=pos+size;const files=new Map(),skipped=[];let total=0;
  for(let i=0;i<count;i++){
    if(pos+46>directoryEnd||d.getUint32(pos,true)!==0x02014b50)throw Error('Invalid ZIP directory');
    const flags=d.getUint16(pos+8,true),method=d.getUint16(pos+10,true),crc=d.getUint32(pos+16,true),packed=d.getUint32(pos+20,true),unpacked=d.getUint32(pos+24,true),nl=d.getUint16(pos+28,true),extra=d.getUint16(pos+30,true),comment=d.getUint16(pos+32,true),offset=d.getUint32(pos+42,true);
    if(pos+46+nl+extra+comment>directoryEnd)throw Error('Truncated ZIP directory');
    const name=safePath(new TextDecoder().decode(bytes.subarray(pos+46,pos+46+nl)));pos+=46+nl+extra+comment;
    if(!/\.(ini|inc|png|jpg|jpeg|webp|bmp|gif)$/i.test(name)){if(/\.(dll|exe|lua)$/i.test(name))skipped.push(name);continue;}
    if(flags&1)throw Error('Encrypted packages are not supported');if(![0,8].includes(method))throw Error('Unsupported ZIP compression');
    if(unpacked>8*1024*1024||(total+=unpacked)>24*1024*1024)throw Error('Skin assets exceed the 24 MB expanded limit');
    if(offset+30>bytes.length||d.getUint32(offset,true)!==0x04034b50)throw Error('Invalid ZIP entry');
    const start=offset+30+d.getUint16(offset+26,true)+d.getUint16(offset+28,true);if(start+packed>d.getUint32(end+16,true))throw Error('Truncated ZIP entry');
    const content=method===0?bytes.slice(start,start+packed):await inflate(bytes.slice(start,start+packed),unpacked);
    if(content.length!==unpacked||crc32(content)!==crc)throw Error('Skin package checksum failed');
    const key=name.toLowerCase();if(files.has(key))throw Error('Package contains duplicate paths');files.set(key,{name,bytes:content});
  }
  if(pos!==directoryEnd)throw Error('Invalid ZIP directory size');
  return{files,skipped};
}
export async function readSkinFiles(list){
  if(list.length===1&&/\.(zip|rmskin)$/i.test(list[0].name)){if(list[0].size>MAX_ARCHIVE)throw Error('Choose a package smaller than 32 MB');return readArchive(await list[0].arrayBuffer());}
  if(list.length>2000)throw Error('Skin folder exceeds 2,000 entries');const files=new Map(),skipped=[];let total=0;for(const f of list){if(/\.(dll|exe|lua)$/i.test(f.name))skipped.push(f.name);if(!/\.(ini|inc|png|jpg|jpeg|webp|bmp|gif)$/i.test(f.name))continue;if(f.size>8*1024*1024)throw Error('Skin file exceeds 8 MB');if((total+=f.size)>24*1024*1024)throw Error('Skin folder exceeds 24 MB');const name=safePath(f.webkitRelativePath||f.name);const key=name.toLowerCase();if(files.has(key))throw Error('Folder contains duplicate paths');files.set(key,{name,bytes:new Uint8Array(await f.arrayBuffer())});}return{files,skipped};
}
