require('request-promise')({
  url: 'http://ipv4.webshare.io/',
  proxy: 'http://wtqcbrmz:dshl0ygrdwc0@31.59.20.176:6754'
}).then(function(data){
  console.log(data); 
}, function(err){ 
  console.error(err); 
});
