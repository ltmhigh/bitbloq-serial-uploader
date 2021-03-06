/* *******************************************************
 * bitbloq Serial Uploader
 * bitbloqSU.Program - Programming functionality
 ********************************************************* */
'use strict';
/* global sizeof, bitbloqSU, Promise */
/* exported bitbloqSU */
/* Board management functions */

bitbloqSU.Program = {
    // Constants being used from the STK500 protocol
    STK500: {
        CRC_EOP: 0x20, // 'SPACE'
        STK_SET_PARAMETER: 0x40, // '@'
        STK_GET_PARAMETER: 0x41, // 'A'
        STK_SET_DEVICE: 0x42, // 'B'
        STK_SET_DEVICE_EXT: 0x45, // 'E'
        STK_ENTER_PROGMODE: 0x50, // 'P'
        STK_LEAVE_PROGMODE: 0x51, // 'Q'
        STK_LOAD_ADDRESS: 0x55, // 'U'
        STK_UNIVERSAL: 0x56, // 'V'
        STK_PROG_LOCK: 0x63, // 'c'
        STK_PROG_PAGE: 0x64, // 'd'
        STK_READ_PAGE: 0x74, // 't'
        STK_READ_SIGN: 0x75 // 'u'
    },
    SEMAPHORE: false
};

/**
 * ProgramBuilder with program lifecycle methods
 * @param {Object} board board object
 * @param {Number} board.bitrate board bitrate
 */
function ProgramBuilder(board) {
    this.board = board;
    // Useful parameters throughout the code:
    // trimmedCommands store the hex commands that will be passed to the board.
    this.trimmedCommands = undefined;
    // Memory addresses of the different memory pages ---> ATMega328
    this.address_l = [];
    this.address_r = [];
}

ProgramBuilder.prototype.load_hex = function(hex) {
    console.log('ProgramBuilder.load_hex');
    //Default program
    if (!hex) {
        return false;
    }
    // Slice the used information from the input hex file
    var prog_init = hex.split('\r\n');
    var prog = [];
    var i = 0;
    for (i = 0; i < prog_init.length; i++) {
        prog_init[i] = prog_init[i].slice(9, prog_init[i].length - 2);
    }
    prog_init = prog_init.join('');
    while (prog_init.length % 256 !== 0) {
        prog_init += 'FF';
    }
    //  Split the information in 2 character commands
    var odd = false;
    var dummy = '';
    for (i = 0; i < prog_init.length; i++) {
        dummy += prog_init[i];
        if (odd) {
            prog.push(parseInt(dummy, 16)); //parse to int from hex string
            dummy = '';
            odd = false;
        } else {
            odd = true;
        }
    }
    return prog;
};

/**
 * Process string-code to calculate & build pages/address
 * @param  {String} hex
 */
ProgramBuilder.prototype.transformData = function(hex) {
    console.log('ProgramBuilder.transformData');
    //load commands
    var command = this.load_hex(hex);
    //Number of memory pages for current program that is needed
    this.numPages = Math.ceil(command.length / (this.board.maxPageSize));

    //console.info(command.length);
    //console.info('Total page number', this.numPages);

    var i = 0;
    this.trimmedCommands = [];
    while (this.trimmedCommands.length < this.numPages) {
        this.trimmedCommands.push(command.slice(this.board.maxPageSize * i, (this.board.maxPageSize) * (i + 1)));
        i += 1;
    }
    // init adresses
    for (i = 0; i < this.numPages; i++) {
        this.address_l.push(0x00);
        this.address_l.push(0x40);
        this.address_l.push(0x80);
        this.address_l.push(0xc0);
        this.address_r.push(i);
        this.address_r.push(i);
        this.address_r.push(i);
        this.address_r.push(i);
    }

    console.info('Program size: ', sizeof(this.trimmedCommands), '. Max size available in the board: ', this.board.max_size);
};

/**
 * Send change singnals to board
 * @return {Promise} Returns a promise that resolves with the chansignals sended
 */
ProgramBuilder.prototype.changeSignals = function(callback) {
    console.log('ProgramBuilder.changeSignals');

    // DTR-RTS ON
    var signalControlOn = {
        dtr: true,
        rts: true
    };
    // DTR-RTS OFF
    var signalControlOff = {
        dtr: false,
        rts: false
    };

    bitbloqSU.Serial.setControlSignals(signalControlOn, function() {
        console.info('DTR-RTS ON');
        bitbloqSU.Serial.setControlSignals(signalControlOff, function() {
            console.info('DTR-RTS OFF');
            callback();
        });
    });

};

/**
 * Send the commands to enter the programming mode
 * @return {Promise} A promise that resolves when the board is in prog mode
 */
ProgramBuilder.prototype.enterProgMode = function() {

    console.log('ProgramBuilder.enterProgMode');

    //Sin Espera
    var buffer = new Uint8Array(2);
    buffer[0] = bitbloqSU.Program.STK500.STK_ENTER_PROGMODE;
    buffer[1] = bitbloqSU.Program.STK500.CRC_EOP;
    return bitbloqSU.Serial.sendData(buffer.buffer);

};

/**
 * Send the commands to leave the programming mode
 * @return {Promise} A promise that resolves when the board is not in prog mode
 */
ProgramBuilder.prototype.leaveProgMode = function() {
    console.log('ProgramBuilder.leaveProgMode');
    var buffer = new Uint8Array(2);
    buffer[0] = bitbloqSU.Program.STK500.STK_LEAVE_PROGMODE;
    buffer[1] = bitbloqSU.Program.STK500.CRC_EOP;
    return bitbloqSU.Serial.sendData(buffer.buffer);
};

/**
 * Create and send the commands needed to specify in which memory address we are writting currently
 * @param  {Number} address adress index
 * @return {Promise} A promise that resolves when the address is loaded in the board
 */
ProgramBuilder.prototype.loadAddress = function(address) {
    console.log('ProgramBuilder.loadAddress', address);
    var loadAddress = new Uint8Array(4);
    loadAddress[0] = bitbloqSU.Program.STK500.STK_LOAD_ADDRESS;
    loadAddress[1] = this.address_l[address];
    loadAddress[2] = this.address_r[address];
    loadAddress[3] = bitbloqSU.Program.STK500.CRC_EOP;
    return bitbloqSU.Serial.sendData(loadAddress.buffer).then(function() {
        return address;
    });
};

/**
 * Create the command structure needed to program the current memory page
 * @param  {Number} it
 * @return {Promise} A promise that resolves with the program writed
 */
ProgramBuilder.prototype.programPage = function(it) {
    console.log('ProgramBuilder.programPage', it);

    //console.info('Message length', this.trimmedCommands[it].length);

    var init_part = [
        bitbloqSU.Program.STK500.STK_PROG_PAGE,
        0x00,
        0x80,
        0x46
    ];
    this.trimmedCommands[it] = init_part.concat(this.trimmedCommands[it]);
    this.trimmedCommands[it].push(bitbloqSU.Program.STK500.CRC_EOP);

    //console.info('trimmedCommands[it]', this.trimmedCommands[it]); // log the page that it is currently programming

    var buffer = new Uint8Array(this.trimmedCommands[it].length);
    for (var i = 0; i < buffer.length; i++) {
        buffer[i] = this.trimmedCommands[it][i];
    }
    if (!buffer.buffer.byteLength) {
        console.error('bitbloqProgram.buffer.empty');
    }
    return bitbloqSU.Serial.sendData(buffer.buffer);
};

/**
 * Send reset to board
 * @return {Promise} A promise that resolves with the board reset
 */
ProgramBuilder.prototype.resetBoard = function(callback) {
    var that = this;
    that.changeSignals(function() {
        that.changeSignals(function() {
            setTimeout(callback, bitbloqSU.Program.board.delay_reset);
        });
    });
};

/**
 * writes a
 * @param {Promise} [promise]   A promise that must be resolved to write this page
 * @param {Number} it The page number to write in board
 * @return {Promise} A promise that resolves with the page data wrote in board
 */
ProgramBuilder.prototype.addWriteStep = function(promise, it) {
    var that = this;
    if (!promise) {
        return this.loadAddress(it).then(function(address) {
            return that.programPage(address);
        });
    } else {
        return promise.then(function() {
            return that.loadAddress(it).then(function(address) {
                return that.programPage(address);
            });
        });
    }
};

/**
 * Load Trigger loading process on board
 * @param  {String} code
 * @param  {String} port
 * @param  {Object} board
 * @param  {Number} board.bitrate
 * @return {Promise}   A promise that resolves only when the programming is ok with the following mesasges:
 *                     program:ok               Programming process ok
 *                     program:error:busy       The chromapp is programming
 *                     program:error:connection Cannot connect to board in that port
 *                     program:error:write      Error while writting pages
 *                     program:error:size       Not enough spaces in board
 */
ProgramBuilder.prototype.load = function(code, port) {

    // if (bitbloqSU.Program.SEMAPHORE) {
    //     return Promise.reject('program:error:busy');
    // }
    //bitbloqSU.Program.SEMAPHORE = true;

    //Prepare code to write on board
    this.transformData(code);

    var p = false,
        that = this;

    return new Promise(function(resolve, reject) {

        if (sizeof(that.trimmedCommands) < bitbloqSU.Program.board.max_size) {

            bitbloqSU.Serial.connect(port, bitbloqSU.Program.board.bitrate, function(response) {

                console.log(response);
                //No hay conexión con la placa
                if (response === 'serial:error:connection') {
                    reject('program:error:connection');
                } else { //Programamos la placa

                    that.resetBoard(function() {

                        return that.enterProgMode().then(function() {

                            //Program pages workflow
                            for (var i = 0; i < that.numPages; i++) {
                                p = that.addWriteStep(p, i);
                            }
                            return p
                                .then(that.leaveProgMode.bind(that))
                                .then(function() {
                                    that.resetBoard(function() {
                                        //bitbloqSU.Program.SEMAPHORE = false;
                                        return bitbloqSU.Serial.disconnect().then(function() {
                                            resolve('program:ok');
                                        });
                                    });
                                }).catch(function() {
                                    //bitbloqSU.Program.SEMAPHORE = false;
                                    return bitbloqSU.Serial.disconnect().then(function() {
                                        reject('program:error:write');
                                    });
                                });

                        }).catch(function() {
                            //bitbloqSU.Program.SEMAPHORE = false;
                            return bitbloqSU.Serial.disconnect().then(function() {
                                resolve('program:error:connection');
                            });

                        });

                    });

                } //else

            });

        } else {
            //bitbloqSU.Program.SEMAPHORE = false;
            reject('program:error:size');
        }

    });

};

/**
 * Set the board config to ProgramBuilder and returns a instance of it
 * @param {Object} board
 * @param {Number} board.bitrate
 * @return {ProgramBuilder}
 */
bitbloqSU.Program.setBoard = function(board) {
    console.log('bitbloqSU.program.setBoard', board);
    bitbloqSU.Program.board = board;
    return new ProgramBuilder(board);
};

/**
 * Tries to veify if there is a board connected in a specific port/board
 * @param  {String} port
 * @param  {Object} board
 * @param  {Number} board.bitrate
 * @return {Promise} A promise that resolves only when a board is detected in the specific config
 */
bitbloqSU.Program.testBoard = function(port, board) {

    console.log('bitbloqSU.program.setBoard', board);
    bitbloqSU.Program.board = board;
    var builder = new ProgramBuilder(board);

    return new Promise(function(resolve, reject) {

        bitbloqSU.Serial.connect(port, bitbloqSU.Program.board.bitrate, function(connectionId) {
            console.log(connectionId);

            // Could not connect to board
            if (connectionId === 'serial:error:connection') {
                reject('connectingport:ko');
                return;
            }

            builder.resetBoard(function() {

                builder.enterProgMode().then(function() {

                    //bitbloqSU.Program.SEMAPHORE = false;
                    bitbloqSU.Serial.disconnect().then(function() {
                        console.log('connectingport:ok');
                        resolve('connectingport:ok');
                    });

                }).catch(function() {
                    //bitbloqSU.Program.SEMAPHORE = false;
                    bitbloqSU.Serial.disconnect().then(function() {
                        console.log('connectingport:ko');
                        reject('connectingport:ko');
                    });
                });

            });

        });

    });


};
