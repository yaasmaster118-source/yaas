'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function harness(){
 let layer,keydown,focus;
 const previous={focus(){focus=previous;}};
 const doc={activeElement:previous,body:{append(item){layer=item;}},createElement(){const nodes={p:{},'[data-confirm-cancel]':{focus(){focus=this;doc.activeElement=this;}},'[data-confirm-accept]':{focus(){focus=this;doc.activeElement=this;}}};return{querySelector:key=>nodes[key],remove(){layer=null;}};},addEventListener(_,fn){keydown=fn;},removeEventListener(){keydown=null;}};
 const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const context={document:doc,$:()=>layer};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function confirmInApp('),source.indexOf('function loadLocalEvents(')),context);
 return{run:context.confirmInApp,get layer(){return layer;},key(key){keydown({key,preventDefault(){},stopImmediatePropagation(){}});},get restored(){return focus===previous;}};
}
test('in-app confirmation starts safely, traps focus, cancels with Escape and restores focus',async()=>{const h=harness(),pending=h.run('<unsafe>');assert.equal(h.layer.querySelector('p').textContent,'<unsafe>');assert.equal(await h.run('duplicate'),false);h.key('Tab');h.key('Escape');assert.equal(await pending,false);assert.equal(h.layer,null);assert.equal(h.restored,true);});
test('in-app confirmation requires explicit accept and supports cancel',async()=>{const h=harness();let pending=h.run('confirm');h.layer.querySelector('[data-confirm-cancel]').onclick();assert.equal(await pending,false);pending=h.run('confirm');h.layer.querySelector('[data-confirm-accept]').onclick();assert.equal(await pending,true);assert.equal(h.restored,true);});
