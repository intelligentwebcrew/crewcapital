import http from 'node:http';
import worker from '../worker/index.js';
const server=http.createServer(async(req,res)=>{try{const buffers=[];for await(const b of req)buffers.push(b);const body=Buffer.concat(buffers);const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(body.length?{body,duplex:'half'}:{})});const response=await worker.fetch(request,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}catch{res.writeHead(500);res.end('Local preview error')}});
server.listen(Number(process.env.PORT||4173),'0.0.0.0');
