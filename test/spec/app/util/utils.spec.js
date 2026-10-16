const expect = require('chai').expect;
const utils = require('../../../../app/util/utils');

describe('util.utils', () => {

  describe('ifNotTimedOut', () => {
    const testIfNotTimedOut = (timedout, expectedCalled) => {
      const REQUEST = { timedout };
      let functionCalled = false;
      utils.ifNotTimedOut(REQUEST, () => {
        functionCalled = true;
      });
      expect(functionCalled).to.equal(expectedCalled);
    };

    it('should call the function if it is not timed out', () => {
      testIfNotTimedOut(false, true);
    });

    it('should not the function if it is timed out', () => {
      testIfNotTimedOut(true, false);
    });
  });

  describe('normalizePort', () => {
    const testNormalizePort = (port, expectedValue, expectedType = null) => {
      const response = utils.normalizePort(port);
      if (expectedType) {
        expect(response).to.be.a(expectedType).and.to.equal(expectedValue);
      } else {
        expect(response).to.equal(expectedValue);
      }
    };

    it('should parse and use a numeric string', () => {
      testNormalizePort('1234', 1234, 'number');
    });

    it('should parse and use a zero string', () => {
      testNormalizePort('0', 0, 'number');
    });

    it('should bounce a null', () => {
      const PORT = null;
      testNormalizePort(PORT, PORT);
    });

    it('should bounce an object', () => {
      const PORT = { bob: 'Bob' };
      testNormalizePort(PORT, PORT);
    });

    it('should bounce a string that cannot be parsed as a number', () => {
      const PORT = 'Bob';
      testNormalizePort(PORT, PORT);
    });

    it('should reject an invalid numeric string', () => {
      testNormalizePort('-1234', false);
    });
  });

  describe('onServerError', () => {
    const getSystemError = (code, syscall, message) => {
      return {
        address: 'https://test.address.net',
        code: code,
        errno: 1,
        message: message || 'An error occurred',
        syscall: syscall
      };
    };

    const testErrorHandling = (port, errorCode, syscall, expectedMessage) => {
      const ERROR = getSystemError(errorCode, syscall);
      utils.onServerError(port, logTo.output, exitRoute.exit)(ERROR);
      expect(logTo.logs).to.have.a.lengthOf(1).and.to.contain(expectedMessage);
      expect(exitRoute.calls).to.have.a.lengthOf(1).and.to.contain(1);
    };

    const testErrorThrown = (port, errorCode, syscall, message) => {
      const ERROR = getSystemError(errorCode, syscall, message);
      const onServerError = utils.onServerError(port, logTo.output, exitRoute.exit);
      let errorThrown = null;
      try {
        onServerError(ERROR);
      } catch (err) {
        errorThrown = err;
      }
      expect(errorThrown).to.equal(ERROR);
      expect(logTo.logs).to.have.a.lengthOf(0);
      expect(exitRoute.calls).to.have.a.lengthOf(0);
    };

    let logTo;
    let exitRoute;
    beforeEach(() => {
      logTo = {
        logs: [],
        output: (str) => {
          logTo.logs.push(str);
        }
      };
      exitRoute = {
        calls: [],
        exit: (code) => {
          exitRoute.calls.push(code);
        }
      }
    });

    it('should handle an access error on a numeric port', () => {
      testErrorHandling(1234, 'EACCES', 'listen', 'Port 1234 requires elevated privileges');
    });

    it('should handle an access error on a string port', () => {
      testErrorHandling('BOBBINS', 'EACCES', 'listen', 'Pipe BOBBINS requires elevated privileges');
    });

    it('should handle an address in use error on a numeric port', () => {
      testErrorHandling(1234, 'EADDRINUSE', 'listen', 'Port 1234 is already in use');
    });

    it('should handle an address in use error on a string port', () => {
      testErrorHandling('BOBBINS', 'EADDRINUSE', 'listen', 'Pipe BOBBINS is already in use');
    });

    it('should throw an error when not a listen syscall', () => {
      testErrorThrown(1234, 'EADDRINUSE', 'not listening', `Sorry, what was that? I wasn't listening.`);
    });

    it('should rethrow an unhandled error', () => {
      testErrorThrown(1234, 'PANIC_STATIONS', 'listen');
    });
  });

  describe('onListening', () => {
    let logTo;
    beforeEach(() => {
      logTo = {
        logs: [],
        output: (str) => {
          logTo.logs.push(str);
        }
      };
    });

    const testOnListening = (addressValue, expectedMessage) => {
      const SERVER = {
        address: () => addressValue
      };
      utils.onListening(SERVER, logTo.output)();
      expect(logTo.logs).to.have.a.lengthOf(1).and.to.contain(expectedMessage);
    };

    it('should handle a string address', () => {
      const ADDRESS = 'https://test.address';
      testOnListening(ADDRESS, `Listening on pipe ${ADDRESS}`);
    });

    it('should handle an address with a port', () => {
      const PORT = 6251;
      testOnListening({ port: PORT }, `Listening on port ${PORT}`);
    });
  });

});