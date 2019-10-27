const unpacker = require("./../pod-telemetry-unpacker.js");

const dgram = require('dgram');
const server = dgram.createSocket('udp4');

unpacker.loadXML(__dirname + "/data.xml", (err) => {
	if(err)
		throw err;
});

server.on('error', (err) => {
	console.log("Server error: " + err);
	server.close();
});

// Prints out first packet then quits
server.on('message', (msg, rinfo) => {
	console.log(JSON.stringify(unpacker.unpack(msg), function(key, value){
		// Allows bignumbers to be printed
		return (typeof value === 'bigint') ? value.toString() : value;
	}, 4));
	process.exit(0);
});

server.on('listening', () => {
	const address = server.address();
	console.log('Listening for packets on port ' + address.port + ".");
});

server.bind(3000);
