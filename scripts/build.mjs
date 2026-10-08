import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('src','dist',{recursive:true});
for(const file of ['index.html','app.mjs','model.mjs','video.mjs','style.css','vendor/pdfjs/pdf.mjs','vendor/pdfjs/pdf.worker.mjs'])await readFile('dist/'+file);
console.log('Static build ready: dist/ ('+(await readdir('dist')).length+' entries)');
