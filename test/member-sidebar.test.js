const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),test=require('node:test');
test('member sidebar filters channel access, groups once by highest role and puts offline last',()=>{
const s=fs.readFileSync('app.js','utf8'),start=s.indexOf('function renderMembers()'),end=s.indexOf('function serverIconMarkup',start);
const high={id:'h',name:'High',position:20,role_hoist:true,color:'#fff'},low={id:'l',name:'Low',position:10,role_hoist:true,color:'#fff'};
const nodes={'#member-empty':{classList:{toggle(){}}},'#member-list':{innerHTML:''},'#member-scope-toggle':{}};
const state={user:{id:'a'},activeChannel:{id:'c'},activeServer:{permissions:['members.manage'],members:[{id:'a',display_name:'Alpha',handle:'a',online:true,visible_channel_ids:['c'],roles:[low,high]},{id:'b',display_name:'Beta',handle:'b',online:false,visible_channel_ids:['c'],roles:[high]},{id:'x',display_name:'Hidden',handle:'x',online:true,visible_channel_ids:[],roles:[]}]}};
const context={state,$:id=>nodes[id],$$:()=>[],escapeHtml:String,avatarContent:()=>'',roleIcon:()=>'',openUserProfile(){},removeMemberRole(){},sendFriendRequest(){}};
vm.runInNewContext(s.slice(start,end)+';renderMembers();',context);
const html=nodes['#member-list'].innerHTML;assert.equal((html.match(/data-profile-id="a"/g)||[]).length,1);assert.ok(!html.includes('Hidden'));assert.ok(html.indexOf('High · 1')<html.indexOf('Çevrimdışı'));assert.ok(html.includes('data-sidebar-remove-role'));
nodes['#member-scope-toggle'].onclick();assert.ok(nodes['#member-list'].innerHTML.includes('Hidden'));
});
