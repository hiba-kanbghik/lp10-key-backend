// LP10 Obfuscator engine — Node port of the exact tokenizer/transform logic
// used in the client-side LP10 Obfuscator (anbghik.github.io). Pure JS,
// no DOM dependency, so it runs unchanged inside a Cloud Function.

const KEYWORDS = new Set(["and","break","do","else","elseif","end","false","for","function",
  "goto","if","in","local","nil","not","or","repeat","return","then","true","until","while",
  "self","continue"]);

function isWordChar(ch){ return /[A-Za-z0-9_]/.test(ch); }
function isDigit(ch){ return ch >= '0' && ch <= '9'; }
function isNameStart(ch){ return /[A-Za-z_]/.test(ch); }

function tokenize(src){
  const toks = [];
  let i = 0, n = src.length;
  function longBracketLevel(pos){
    let j = pos + 1, level = 0;
    while (src[j] === '='){ level++; j++; }
    if (src[j] === '[') return { level, end: j+1 };
    return null;
  }
  function readLongBracket(startContentPos, level){
    const closer = ']' + '='.repeat(level) + ']';
    const idx = src.indexOf(closer, startContentPos);
    if (idx === -1) return { content: src.slice(startContentPos), end: n };
    return { content: src.slice(startContentPos, idx), end: idx + closer.length };
  }
  while (i < n){
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n'){
      let j = i; while (j < n && /\s/.test(src[j])) j++;
      toks.push({ t:'ws', v: src.slice(i,j) }); i = j; continue;
    }
    if (ch === '-' && src[i+1] === '-'){
      const lb = (src[i+2] === '[') ? longBracketLevel(i+2) : null;
      if (lb){
        const { end } = readLongBracket(lb.end, lb.level);
        toks.push({ t:'comment', v: src.slice(i, end) }); i = end; continue;
      } else {
        let j = i+2; while (j < n && src[j] !== '\n') j++;
        toks.push({ t:'comment', v: src.slice(i, j) }); i = j; continue;
      }
    }
    if (ch === '[' && (src[i+1] === '[' || src[i+1] === '=')){
      const lb = longBracketLevel(i);
      if (lb){
        const { content, end } = readLongBracket(lb.end, lb.level);
        toks.push({ t:'longstring', v: src.slice(i,end), raw: content }); i = end; continue;
      }
    }
    if (ch === '"' || ch === "'"){
      const quote = ch; let j = i+1; let raw = '';
      while (j < n && src[j] !== quote){
        if (src[j] === '\\'){ raw += src[j] + (src[j+1]||''); j += 2; }
        else { raw += src[j]; j++; }
      }
      j++;
      toks.push({ t:'string', v: src.slice(i,j), quote, raw }); i = j; continue;
    }
    if (isDigit(ch) || (ch === '.' && isDigit(src[i+1]))){
      let j = i;
      if (ch === '0' && (src[i+1] === 'x' || src[i+1] === 'X')){
        j = i+2; while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
      } else {
        while (j < n && isDigit(src[j])) j++;
        if (src[j] === '.'){ j++; while (j < n && isDigit(src[j])) j++; }
        if (src[j] === 'e' || src[j] === 'E'){ j++; if (src[j]==='+'||src[j]==='-') j++; while (j<n && isDigit(src[j])) j++; }
      }
      toks.push({ t:'number', v: src.slice(i,j) }); i = j; continue;
    }
    if (isNameStart(ch)){
      let j = i+1; while (j < n && isWordChar(src[j])) j++;
      const v = src.slice(i,j);
      toks.push({ t: KEYWORDS.has(v) ? 'keyword' : 'name', v }); i = j; continue;
    }
    const three = src.slice(i,i+3);
    if (three === '...'){ toks.push({t:'sym',v:three}); i+=3; continue; }
    const two = src.slice(i,i+2);
    if (['==','~=','<=','>=','..','::','//'].includes(two)){ toks.push({t:'sym',v:two}); i+=2; continue; }
    toks.push({ t:'sym', v: ch }); i++;
  }
  return toks;
}

function decodeLuaString(raw){
  let out = '';
  for (let i=0;i<raw.length;i++){
    if (raw[i] === '\\'){
      const c = raw[i+1];
      if (c === 'n'){ out+='\n'; i++; }
      else if (c === 't'){ out+='\t'; i++; }
      else if (c === 'r'){ out+='\r'; i++; }
      else if (c === 'a'){ out+='\x07'; i++; }
      else if (c === 'b'){ out+='\b'; i++; }
      else if (c === 'f'){ out+='\f'; i++; }
      else if (c === 'v'){ out+='\v'; i++; }
      else if (c === '\\'){ out+='\\'; i++; }
      else if (c === '"'){ out+='"'; i++; }
      else if (c === "'"){ out+="'"; i++; }
      else if (c === '\n'){ out+='\n'; i++; }
      else if (c === 'x'){ const hex = raw.slice(i+2,i+4); out += String.fromCharCode(parseInt(hex,16)); i+=3; }
      else if (/[0-9]/.test(c)){ let j=i+1,num=''; while(j<raw.length && num.length<3 && /[0-9]/.test(raw[j])){num+=raw[j];j++;} out+=String.fromCharCode(parseInt(num,10)); i=j-1; }
      else { out += c; i++; }
    } else { out += raw[i]; }
  }
  return out;
}

function randName(counter){
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n = counter, s = '';
  do { s = letters[n % letters.length] + s; n = Math.floor(n/letters.length) - 1; } while (n >= 0);
  return '_' + s + (counter % 7 === 0 ? Math.floor(Math.random()*9) : '');
}

function rngInt(max){ return Math.floor(Math.random()*max); }

function obfuscate(src, opts){
  opts = Object.assign({ stripComments:true, encryptStrings:true, splitNumbers:true, renameLocals:true }, opts||{});
  let toks = tokenize(src);
  if (opts.stripComments) toks = toks.filter(t => t.t !== 'comment');

  const renameMap = new Map();
  let counter = 0;
  function reg(name){
    if (KEYWORDS.has(name)) return;
    if (!renameMap.has(name)){ renameMap.set(name, randName(counter++)); }
  }
  if (opts.renameLocals){
    const sig = toks.filter(t => t.t !== 'ws');
    for (let k=0;k<sig.length;k++){
      const t = sig[k];
      if (t.t === 'keyword' && t.v === 'local'){
        if (sig[k+1] && sig[k+1].v === 'function' && sig[k+2] && sig[k+2].t === 'name'){
          reg(sig[k+2].v);
          let p = k+3;
          if (sig[p] && sig[p].v === '('){
            p++;
            while (sig[p] && sig[p].v !== ')'){
              if (sig[p].t === 'name') reg(sig[p].v);
              p++;
            }
          }
          continue;
        }
        let p = k+1;
        while (sig[p] && (sig[p].t === 'name')){
          reg(sig[p].v);
          p++;
          if (sig[p] && sig[p].v === ',') { p++; continue; }
          break;
        }
      }
      if (t.t === 'keyword' && t.v === 'function'){
        let p = k+1;
        while (sig[p] && sig[p].t === 'name'){
          p++;
          if (sig[p] && (sig[p].v === '.' || sig[p].v === ':')) { p++; continue; }
          break;
        }
        if (sig[p] && sig[p].v === '('){
          p++;
          while (sig[p] && sig[p].v !== ')'){
            if (sig[p].t === 'name') reg(sig[p].v);
            p++;
          }
        }
      }
      if (t.t === 'keyword' && t.v === 'for'){
        let p = k+1;
        while (sig[p] && sig[p].t === 'name'){
          reg(sig[p].v);
          p++;
          if (sig[p] && sig[p].v === ',') { p++; continue; }
          break;
        }
      }
    }
  }

  const sig = toks.filter(t => t.t !== 'ws');
  const enclosing = new Array(sig.length);
  {
    const stack = [];
    for (let k=0;k<sig.length;k++){
      enclosing[k] = stack.length ? stack[stack.length-1] : null;
      const v = sig[k].v;
      if (v === '(' || v === '[' || v === '{') stack.push(v);
      else if (v === ')' || v === ']' || v === '}') stack.pop();
    }
  }

  const out = [];
  let strCounter = 0;

  for (let k=0;k<sig.length;k++){
    const t = sig[k];
    const prevSig = sig[k-1];
    const nextSig = sig[k+1];

    if (t.t === 'name' && opts.renameLocals && renameMap.has(t.v)){
      const isFieldAccess = prevSig && (prevSig.v === '.' || prevSig.v === ':');
      const isTableKey = enclosing[k] === '{' && nextSig && nextSig.v === '=' &&
                          sig[k+2] && sig[k+2].v !== '=';
      if (!isFieldAccess && !isTableKey){
        out.push({ t:'name', v: renameMap.get(t.v) });
        continue;
      }
    }

    if (t.t === 'string' && opts.encryptStrings){
      const raw = decodeLuaString(t.raw);
      const key = 17 + rngInt(230);
      const bytes = [];
      for (let b=0;b<raw.length;b++) bytes.push(((raw.charCodeAt(b) & 0xFF) ^ key ^ (b % 251)) );
      strCounter++;
      out.push({ t:'call', v: `__LPDEC({${bytes.join(',')}},${key})` });
      continue;
    }

    if (t.t === 'number' && opts.splitNumbers && /^[0-9]+$/.test(t.v) && t.v.length < 10){
      const val = parseInt(t.v,10);
      if (val >= 2 && val <= 1e9){
        const mode = rngInt(3);
        let expr;
        if (mode === 0){ const a = rngInt(val); expr = `(${a}+${val-a})`; }
        else if (mode === 1){ const a = 2 + rngInt(Math.max(1,Math.min(9, Math.floor(val/2)))); const rem = val % a; const div = Math.floor(val/a); expr = rem===0? `(${a}*${div})` : `(${a}*${div}+${rem})`; }
        else { const a = val + 1 + rngInt(50); expr = `(${a}-${a-val})`; }
        out.push({ t:'number', v: expr });
        continue;
      }
    }

    out.push(t);
  }

  function tokText(t){
    if (t.t === 'string') return t.v;
    if (t.t === 'longstring') return t.v;
    return t.v;
  }
  let result = '';
  for (let k=0;k<out.length;k++){
    const t = out[k];
    const txt = tokText(t);
    if (k>0){
      const prev = out[k-1];
      const pTxt = tokText(prev);
      const pLast = pTxt[pTxt.length-1];
      const cFirst = txt[0];
      const bothWord = /[A-Za-z0-9_)]/.test(pLast) && /[A-Za-z0-9_(]/.test(cFirst) && !(prev.t==='sym' && /[()\[\]{},;]/.test(pLast));
      const dashDash = pLast === '-' && cFirst === '-';
      const dotDigit = pLast === '.' && /[0-9]/.test(cFirst);
      if (bothWord || dashDash || dotDigit) result += ' ';
    }
    result += txt;
  }

  const decoderFn = opts.encryptStrings
    ? `local function __LPDEC(t,k)local o={}for i=1,#t do o[i]=string.char((t[i]~k~((i-1)%251))%256)end;return table.concat(o)end\n`
    : '';

  return decoderFn + result;
}

// Same regex-replace merge used by the browser tool: finds the
// loadstring(game:HttpGet(...))() line in the key-system template and
// swaps it for a do...end block holding the obfuscated script directly,
// with \n padding so no two `end` keywords ever glue together.
function mergeIntoKeySystem(ksSrc, scriptObf){
  const re = /loadstring\s*\(\s*game\s*:\s*HttpGet\s*\([^)]*\)\s*\)\s*\(\s*\)/;
  if (re.test(ksSrc)){
    return { merged: ksSrc.replace(re, '\ndo\n' + scriptObf + '\nend\n'), matched: true };
  }
  return {
    merged: ksSrc + '\n\n-- LP10: no loadstring(game:HttpGet(...))() line was found, so the script\n-- below was appended instead of replacing it — please check placement.\ndo\n' + scriptObf + '\nend\n',
    matched: false
  };
}

module.exports = { tokenize, obfuscate, mergeIntoKeySystem };
