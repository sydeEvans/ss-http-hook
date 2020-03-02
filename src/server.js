const net = require('net');
const Encryptor = require("../shadowsocks/encrypt").Encryptor;
const inet = require("../shadowsocks/inet");
const utils = require('../shadowsocks/utils');



module.exports = function main (config) {
  const {
    serverIp,
    serverPort,
    password,
    timeout,
    method
  } = config;

  let connections = 0;
  const netServer = net.createServer((conn) => {
    let encryptor = new Encryptor(password, method);
    let stage = 0;
    let headerLength = 0;
    let remoteSocket = null;
    let cachedPieces = [];
    let addrLen = 0;
    let remoteAddr = null;
    let remotePort = null;

    const clean = function () {
      connections -= 1;
      remoteSocket = null;
      conn = null;
      encryptor = null;
    };

    conn.on('data', data => {
      let addrtype, buf;

      try {
        // 对客户端过来的数据进行解码
        data = encryptor.decrypt(data);
      } catch (e) {
        console.error(e);
        if (remoteSocket) {
          remoteSocket.destroy();
        }
        if (conn) {
          conn.destroy();
        }
        return;
      }

      if (stage === 5) { // 状态5，功能未知
        if (!remoteSocket.write(data)) {
          conn.pause();
        }
        return;
      }

      if (stage === 4) {
        return cachedPieces.push(data);
      }

      if (stage === 0) {
        addrtype = data[0]; // addrtype 地址类型？shadowsocks协议一部分？
        if (addrtype === void 0) {
          return;
        }
        if (addrtype === 3) {
          addrLen = data[1];
        } else if (addrtype !== 1 && addrtype !== 4) {
          utils.error("unsupported addrtype: " + addrtype + " maybe wrong password");
          conn.destroy();
          return;
        }
        if (addrtype === 1) {
          remoteAddr = utils.inetNtoa(data.slice(1, 5));
          remotePort = data.readUInt16BE(5);
          headerLength = 7;
        } else if (addrtype === 4) {
          remoteAddr = inet.inet_ntop(data.slice(1, 17));
          remotePort = data.readUInt16BE(17);
          headerLength = 19;
        } else {
          remoteAddr = data.slice(2, 2 + addrLen).toString("binary");
          remotePort = data.readUInt16BE(2 + addrLen);
          headerLength = 2 + addrLen + 2;
        }

        if (data.length > headerLength) {
          buf = new Buffer(data.length - headerLength);
          data.copy(buf, 0, headerLength);
          cachedPieces.push(buf);
          buf = null;
        }
        stage = 4;

        const piece = cachedPieces[0];
        if (piece) {
          const method = piece.toString('utf8', 0, 3);
          if (method.toUpperCase() === 'GET') {
            console.log(piece.toString())
            const bbuf = Buffer.from('<div>hello world</div>')
            return conn.end(encryptor.encrypt(bbuf))
          }
        }

        // 从上述协议中解析出访问的地址和端口
        conn.pause();

        remoteSocket = net.connect(remotePort, remoteAddr, () => {
          console.log("connecting " + remoteAddr + ":" + remotePort);

          if (!encryptor || !remoteSocket || !conn) {
            if (remoteSocket) remoteSocket.destroy();
            return;
          }
          conn.resume();

          let i = 0;
          while (i < cachedPieces.length) { // cachedPieces传给远程，用处不明
            const piece = cachedPieces[i];
            remoteSocket.write(piece);
            i++;

            // const method = piece.toString('utf8', 0, 3);
            // if (method.toUpperCase() === 'GET') {
            //   console.log(piece.toString())
            // }
          }

          // console.log(cachedPieces[0], cachedPieces[0].toString())

          // 远程超时时，销毁链接
          remoteSocket.setTimeout(timeout, function () {
            utils.debug("remote on timeout during connect()");
            if (remoteSocket) {
              remoteSocket.destroy();
            }
            if (conn) {
              return conn.destroy();
            }
          });

          // 链接远程端口成功后，状态置为5
          stage = 5;
        });
        remoteSocket.on("data", (data) => {
          if (!encryptor) {
            if (remoteSocket) {
              remoteSocket.destroy();
            }
            return;
          }
          // 将数据加密，并写给客户端
          data = encryptor.encrypt(data);
          if (!conn.write(data)) {
            return remoteSocket.pause();
          }
        });
        remoteSocket.on("end", function () {
          utils.debug("remote on end");
          if (conn) {
            return conn.end();
          }
        });
        remoteSocket.on("error", function (e) {
          utils.debug("remote on error");
          return utils.error("remote " + remoteAddr + ":" + remotePort + " error: " + e);
        });
        remoteSocket.on("close", function (had_error) {
          utils.debug("remote on close:" + had_error);
          if (had_error) {
            if (conn) {
              return conn.destroy();
            }
          } else {
            if (conn) {
              return conn.end();
            }
          }
        });
        remoteSocket.on("drain", function () {
          utils.debug("remote on drain");
          if (conn) {
            return conn.resume();
          }
        });
        remoteSocket.setTimeout(15 * 1000, function () {
          utils.debug("remote on timeout during connect()");
          if (remoteSocket) {
            remoteSocket.destroy();
          }
          if (conn) {
            return conn.destroy();
          }
        });
      }

    });


    conn.on("end", function () {
      utils.debug("connection on end");
      if (remoteSocket) {
        return remoteSocket.end();
      }
    });

    conn.on("error", function (e) {
      utils.debug("connection on error");
      return utils.error("local error: " + e);
    });
    conn.on("close", function (had_error) {
      utils.debug("connection on close:" + had_error);
      if (had_error) {
        if (remoteSocket) {
          remoteSocket.destroy();
        }
      } else {
        if (remoteSocket) {
          remoteSocket.end();
        }
      }
      return clean();
    });
    conn.on("drain", function () {
      utils.debug("connection on drain");
      if (remoteSocket) {
        return remoteSocket.resume();
      }
    });

    conn.setTimeout(timeout, function () {
      utils.debug("connection on timeout");
      if (remoteSocket) {
        remoteSocket.destroy();
      }
      if (conn) {
        return conn.destroy();
      }
    });

  });

  netServer.listen(serverPort, serverIp, () => {
    console.log('server listening at', serverIp, serverPort)
  });

  netServer.on('error', e => {
    console.log(e);
  })
}
