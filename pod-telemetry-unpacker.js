const CRC32 = require('crc-32')
const xml2js = require('xml2js')
const fs = require('fs');
const MathJS = require("mathjs")

// Defines the endianness of the buffer read operations
let endian = "LE" // BE (big endian) or LE (little endian)

// Dictionary of information about each field
let fields;
// A tree structure of the data
let structure;

// Maps data types to byte lengths
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

// Maps data types to NodeJS Buffer conversion methods
const bufferConversion = {
    "int": "readInt32" + endian,
    "double": "readDouble" + endian,
    "float": "readFloat" + endian,
    "uint8_t": "readUInt8",
    "uint16_t": "readUInt16" + endian,
    "uint32_t": "readUInt32" + endian,
    "uint64_t": "readBigUInt64" + endian,
    "int8_t": "readInt8",
    "int16_t": "readInt16" + endian,
    "int32_t": "readInt32" + endian,
    "bool": "readUInt8",
}

/**
 * Sets the endianness of the Buffer read operations.
 * Endianness defaults to big endianness.
 * @param {string} endianness "BE" for big endian, "LE" for little endian
 */
module.exports.setEndianness = (endianness) => {
    if(endianness != "BE" && endianness != "LE")
        throw new Exception("Invalid endianness; Should be 'BE' or 'LE'.")
    endian = endianness;
}

/**
 * Retreives the endianness used by the buffer read operations.
 * @returns 'BE' for big endian or 'LE' for litle endian
 */
module.exports.getEndianness = () => endian;

/**
 * Checks whether or not the header of a packet is correct.
 * If the header is not correct, the packet is dropped.
 * @param {Buffer} packet The packet to be checked
 */
module.exports.verifyHeader = (packet) => {
    return packet["readUInt" + endian](0, 3) == 0xBAD6E4;
}

/**
 * Checks whether or not the CRC32 included in the packet is correct.
 * The CRC32 in this case acts as a checksum. If they do not match,
 * the packet is dropped.
 * @param {Buffer} packet The packet to be checked
 */
module.exports.verifyCRC32 = (packet) => {
    dataOnlyBuffer = packet.slice(0, packet.length - 4)
    return (CRC32.buf(dataOnlyBuffer)) ==  packet["readInt32" + endian](packet.length - 4);
}

/**
 * Unpacks a buffer into a data structure mirroring that
 * of data.h in the pod-embedded code.
 * @param {buffer} packet The binary data to be unpacked
 */
module.exports.unpack = (packet) => {
    module.packet = packet;
    let data = {};

    // Drop the packet if the header does not match HEADER or if the CRC32 is incorrect
    if(!(module.exports.verifyHeader(packet) && module.exports.verifyCRC32(packet))){
        return null;
    }
    
    if(fields === undefined)
        throw new Exception("The data XML file has not yet been loaded!")
    else {
        let current = 24
        let arrayValues = [];
        
        fields.forEach((field) => {
            // If the field has an index (is part of an array), register it as an array
            if(field.index != undefined && !arrayValues.includes(field.id))
                arrayValues.push(field.id);
            data[field.id + (field.index != undefined ? "[" + field.index + "]" : "")] = packet[field.converter](current)
            current += field.size;
        })

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
    }

    let mappedStructure = mapFieldDictionaryToStructure(data, structure);
    
    // Add everything sent by the telemetry packet not stored in data.h
    mappedStructure.packetNumber = packet["readUInt32" + endian](3)
    mappedStructure.time = packet["readBigUInt64" + endian](7)

    if(!mappedStructure.hasOwnProperty("bms")) mappedStructure.bms = {};
    mappedStructure.bms.imdStatus = packet["readUInt8"](15)

    if(!mappedStructure.hasOwnProperty("pressure")) mappedStructure.pressure = {};
    mappedStructure.pressure.primBrake = packet["readInt32" + endian](16)
    mappedStructure.pressure.secBrake = packet["readInt32" + endian](20)


    return mappedStructure;
}

/**
 * Loads a XML structure and sets up each field for unpacking
 * @param filepath The filepath of the xml file to be loaded
 * @param callback Called when the function has completed
 */
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

            // Generate the heirerarchical structure each individual field is placed onto
            structure = generateStructure(json["struct"]);


            callback()
        })
    })
}

/**
 * Recurrsively searches a given javascript object
 * looking for, and returning, elements with a given
 * name
 */
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

/**
 * Recurrsively maps the fields and structures of an xml2js
 * json object to reflect the data.h data structure in the
 * pod-embedded code. All fields are set to null. The
 * individual fields of the structure are intended to be
 * assigned later.
 * 
 * Example output:
 * 
 * data: {
 *      someStructure: {
 *          someFieldA: null,
 *          someFieldB: null
 *      }
 *      someFieldC: null
 * }
 * 
 * @param json The xml2js json structure to be mapped to a tree
 */
function generateStructure(json){
    let obj = {}
    for (let prop in json){
        if(prop == "$") continue;
        if(prop == "field"){
            json[prop].forEach(field => {
                obj[field.$.id] = null;
            })
        }
        else if (prop == "struct"){
            if(Array.isArray(json[prop]))
                json[prop].forEach((structure, i) => {
                    obj[structure.$.id] = generateStructure(json[prop][i]);
                })
            else
                obj[json[prop].$.id] = generateStructure(json[prop]);
        }
    }
    return obj;
}

/**
 * Recursively loops through a tree structure generated by
 * the generateStructure method above and assigns the
 * variables based on a flat structure (a dictionary)
 * @param fields The flat structure/dictionary which contains all of the fields to be mapped
 * @param structure The tree structure the fields should be mapped to
 */
function mapFieldDictionaryToStructure(fields, structure){
	if(structure == undefined) return {};
    for(a in structure){
        if(structure[a] == null){
            structure[a] = fields[a]
        }else{
            mapFieldDictionaryToStructure(fields, structure[a])
        }
    }
    return structure;
}


/**
** NODE.JS < 12 LTS WORKARROUND
**/

// Create the readBigUInt64BE function if Node.js version is < 12 LTS
if(!Buffer.prototype.hasOwnProperty("readBigUInt64BE")){
	Object.defineProperty(Buffer.prototype, "readBigUInt64BE", { value: function readBigUInt64BE(offset) {
	    let firstHalf = this["readUInt32BE"](offset);
		let secondHalf = this["readUInt32BE"](offset + 4);

		return MathJS.evaluate((firstHalf) + "*(2^(32)) + " + (secondHalf));
	}});
}

// Create the readBigUInt64LE function if Node.js version is < 12 LTS
if(!Buffer.prototype.hasOwnProperty("readBigUInt64LE")){
	Object.defineProperty(Buffer.prototype, "readBigUInt64LE", { value: function readBigUInt64LE(offset) {
	    let firstHalf = this["readUInt32LE"](offset);
		let secondHalf = this["readUInt32LE"](offset + 4);

    	return MathJS.evaluate((firstHalf) + " + (2^(32))*" + (secondHalf));
	}});
}