const unpacker = require("./../pod-telemetry-unpacker.js");

const dgram = require('dgram');
const server = dgram.createSocket('udp4');

server.on('error', (err) => {
	console.log("Server error: " + err);
	server.close();
});

// Prints out first packet then quits
unpacker.loadXML(__dirname + "/data.xml", (err) => {
	if(err)
		throw err;
	server.on('message', (msg, rinfo) => {
		let unpackedPacket = unpacker.unpack(msg)
		if(unpackedPacket == null){
			console.log("A packet was dropped.")
			return;
		}
		console.log(JSON.stringify(unpackedPacket, (key, value) => {
			// Allows bignumbers to be printed
			return (typeof value === 'bigint') ? value.toString() : value;
		}, 4));
		process.exit(0);
	});
});

server.on('listening', () => {
	const address = server.address();
	console.log('Listening for packets on port ' + address.port + ".");
});

server.bind(3000);
