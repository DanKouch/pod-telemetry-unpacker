const HEADER = 0xBAD6E4
const endian = "LITTLE"

const CRC32 = require('crc-32')
const xml2js = require('xml2js')
const fs = require('fs');

let fields;

const sizeOf = {
    "int": 4,
    "double": 8,
    "float": 4,
    "uint8_t": 1,
    "uint16_t": 2,
    "uint32_t": 4,
    "uint64_t": 8,
    "int8_t": 1,
    "int16_t": 2,
    "int32_t": 4,
    "int64_t": 8,
    "bool": 1,
}

const bufferConversion = {
    "int": "readInt32BE",
    "double": "readDoubleBE",
    "float": "readFloatBE",
    "uint8_t": "readUInt8",
    "uint16_t": "readUInt16BE",
    "uint32_t": "readUInt32BE",
    "uint64_t": "readBigUInt64BE",
    "int8_t": "readInt8",
    "int16_t": "readInt16BE",
    "int32_t": "readInt32BE",
    "int64_t": "readBigInt64BE",
    "bool": "readUInt8",
}

function verifyHeader(){
    return module.packet.readUIntBE(0, 3) == HEADER;
}

function verifyCRC32(){
    dataOnlyBuffer = module.packet.slice(0, module.packet.length - 4)
    return (CRC32.buf(dataOnlyBuffer)) ==  module.packet.readInt32BE(module.packet.length - 4);
}

module.exports.unpack = (packet) => {
    module.packet = packet;
    let data = {};

    // Drop the packet if the header does not match HEADER or if the CRC32 is incorrect
    if(!verifyHeader() || !verifyCRC32()){
        console.warn("Dropped packet")
        return null;
    }
    
    data.packetNumber = packet["readUInt32BE"](3);
    
    let arrayValues = [];

    if(fields === undefined)
        console.warn("The XML has not been loaded.");
    else {
        let current = 7
        
        fields.forEach((field) => {
            // If the field has an index (is part of an array), register it as an array
            if(field.index != undefined && !arrayValues.includes(field.id))
                arrayValues.push(field.id);
            data[field.id + (field.index != undefined ? "[" + field.index + "]" : "")] = packet[field.converter](current)
            current += field.size;
        })
    }

    // Deal with bools
    fields.filter(f => f.type == "bool").forEach(f => {
        data[f.id] = data[f.id] == 1 ? true : false
    })

    // Reassemble arrays
    arrayValues.forEach(id => {
        data[id] = [];
        for(let prop in data){
            if(prop.startsWith(id + "[")){
                data[id].push(data[prop])
                delete data[prop]
            }
        }
    })

    return data;
}

module.exports.loadXML = (filepath, callback) => {
    fs.readFile(filepath, (err, data) => {
        if(err != undefined)
            if(err){
                callback(err)
                return;
            }
        new xml2js.Parser().parseString(data, (err, json) => {
            if(err){
                callback(err)
                return;
            }
            // Find all fields
            let f = searchForNodesWithName(json, "field").reduce((acc, cur) => acc.concat(cur), []).map((a) => a["$"]);

            // De-array the fields (Each element of the array becomes its own field)
            f = f.reduce((acc, cur) => {
                if(cur.type.includes("[")){
                    let size = parseInt(cur.type.split("[")[1].split("]")[0])
                    for(let i = 0; i < size; i++)
                        acc.push({id: cur.id, index: i, type: cur.type.split("[")[0]});
                    return acc;
                }else{
                    acc.push(cur);
                    return acc;
                }
            }, []);

            // Tie-in reference dictionaries for useful output
            f = f.map(field => {
                field.size = sizeOf[field.type]
                field.converter = bufferConversion[field.type]
                return field
            })

            fields = f;
            callback()
        })
    })
}

function searchForNodesWithName(obj, name, out){
    if(out === undefined)
        out = []
    for(let prop in obj){
        if(obj.hasOwnProperty(prop)){
            if(prop == "$") continue;
            if(prop == name){
                out.push(obj[prop]);
                continue;
            }
            searchForNodesWithName(obj[prop], name, out)
        }
    }
    return out
    
}