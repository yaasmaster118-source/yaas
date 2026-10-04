"use strict";
const DM_EMOJIS={
  'Yüzler':[['😀','mutlu gülümse'],['😃','gülmek'],['😂','kahkaha'],['🤣','kahkaha'],['😊','mutlu'],['🥰','sevgi'],['😍','aşk'],['😎','havalı'],['🥳','kutlama'],['😅','ter'],['🥲','üzgün'],['😴','uyku'],['🤔','düşünce'],['😭','ağlamak'],['😡','kızgın'],['😱','şaşkın'],['🤯','şaşkın'],['😋','lezzet'],['🤩','yıldız'],['🙃','ters']],
  'Kalpler':[['❤️','kalp aşk'],['💛','sarı kalp'],['💜','mor kalp'],['💙','mavi kalp'],['🖤','siyah kalp'],['🤍','beyaz kalp'],['💕','sevgi'],['💔','kırık kalp'],['💖','parlak kalp'],['💯','yüz']],
  'Hareketler':[['👍','beğen tamam'],['👎','beğenmedim'],['👋','merhaba selam'],['👏','alkış'],['🙌','kutlama'],['🤝','anlaşma'],['✌️','zafer'],['🤞','şans'],['💪','güç'],['🙏','teşekkür'],['🫶','sevgi'],['👌','tamam']],
  'Hayvanlar':[['🐱','kedi'],['🐶','köpek'],['🐻','ayı'],['🦊','tilki'],['🐼','panda'],['🐸','kurbağa'],['🦁','aslan'],['🐯','kaplan'],['🦋','kelebek'],['🐝','arı']],
  'Etkinlik':[['🔥','ateş'],['🎉','kutlama parti'],['✨','parıltı'],['⭐','yıldız'],['🎮','oyun'],['🏆','ödül kupa'],['🎵','müzik'],['🎤','mikrofon'],['📷','kamera fotoğraf'],['🍕','pizza'],['☕','kahve'],['🚀','roket'],['⚽','futbol'],['🎁','hediye']]
};
const DM_GIFS=[['merhaba','Merhaba','selam hello'],['kahkaha','Kahkaha','komik gülmek lol'],['tesekkur','Teşekkür','sağol thanks'],['tebrikler','Tebrikler','kutlama alkış bravo'],['kalp','Kalp','aşk sevgi love'],['tamam','Tamam','ok evet onay'],['hayir','Hayır','no olmaz'],['sasirdim','Şaşırdım','şaşkın wow'],['iyi-geceler','İyi geceler','uyku night'],['oyun','Oyun zamanı','gaming game oyun']].map(([id,title,keywords])=>({id,title,keywords,src:`/assets/dm-gifs/${id}.gif`}));
const DM_STICKERS=['Merhaba','Kalp','Yıldız','Tebrikler','Tamam'].map((title,index)=>({id:'sticker-'+index,title,keywords:title,src:`/assets/dm-gifs/sticker-${index}.gif`}));
function dmCatalogSearch(items,term){const query=String(term||'').trim().toLocaleLowerCase('tr-TR');return items.filter(item=>`${item.title||item[0]} ${item.keywords||item[1]}`.toLocaleLowerCase('tr-TR').includes(query));}
if(typeof module!=='undefined')module.exports={DM_EMOJIS,DM_GIFS,DM_STICKERS,dmCatalogSearch};
if(typeof window!=='undefined')window.dmCatalog={emojis:DM_EMOJIS,gifs:DM_GIFS,stickers:DM_STICKERS,search:dmCatalogSearch};
