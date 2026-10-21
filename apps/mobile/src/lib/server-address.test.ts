import * as SecureStore from 'expo-secure-store';
import {
  __resetServerAddress,
  apiUrl,
  displayServerAddress,
  loadServerAddress,
  normaliseServerAddress,
  setServerAddress,
} from './server-address';

/**
 * The server address typed on a preview build's sign-in screen. What matters is that the
 * things a person would plausibly type all work, and that the choice survives a restart —
 * otherwise an installed APK forgets which laptop it was talking to every time it opens.
 */

const store = SecureStore as unknown as { __reset: () => void };

beforeEach(() => {
  store.__reset();
  __resetServerAddress();
});

describe('normaliseServerAddress', () => {
  it.each([
    ['192.168.1.23:4000', 'http://192.168.1.23:4000/api/v1'],
    ['http://192.168.1.23:4000', 'http://192.168.1.23:4000/api/v1'],
    ['http://192.168.1.23:4000/', 'http://192.168.1.23:4000/api/v1'],
    ['  192.168.1.23:4000  ', 'http://192.168.1.23:4000/api/v1'],
    ['http://192.168.1.23:4000/api/v1', 'http://192.168.1.23:4000/api/v1'],
    ['https://api.example.com', 'https://api.example.com/api/v1'],
    ['https://example.com/badminton/api/v1/', 'https://example.com/badminton/api/v1'],
    ['laptop.local:4000', 'http://laptop.local:4000/api/v1'],
  ])('reads %s as %s', (typed, expected) => {
    expect(normaliseServerAddress(typed)).toBe(expected);
  });

  it.each([[''], ['   '], ['ftp://192.168.1.23'], ['http://'], ['not a url at all']])(
    'rejects %j',
    (typed) => {
      expect(normaliseServerAddress(typed)).toBeNull();
    },
  );

  it('does not guess a port', () => {
    // Adding :4000 would be wrong for every address that is not a local API.
    expect(normaliseServerAddress('192.168.1.23')).toBe('http://192.168.1.23/api/v1');
  });
});

describe('the address in use', () => {
  it('starts as the address compiled into the build', () => {
    expect(apiUrl()).toBe('http://api.test/api/v1');
  });

  it('switches to the typed address and survives a restart', async () => {
    await setServerAddress('192.168.1.23:4000');
    expect(apiUrl()).toBe('http://192.168.1.23:4000/api/v1');

    // A relaunch: memory is gone, storage is not.
    __resetServerAddress();
    expect(apiUrl()).toBe('http://api.test/api/v1');
    await loadServerAddress();
    expect(apiUrl()).toBe('http://192.168.1.23:4000/api/v1');
  });

  it('refuses an unusable address and keeps the current one', async () => {
    await expect(setServerAddress('ftp://nope')).rejects.toThrow(/192\.168\.1\.23:4000/);
    expect(apiUrl()).toBe('http://api.test/api/v1');
  });

  it('shows the address without the version prefix', () => {
    expect(displayServerAddress('http://192.168.1.23:4000/api/v1')).toBe(
      'http://192.168.1.23:4000',
    );
  });
});

describe('in a store build', () => {
  it('ignores any saved or typed address', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('./config', () => ({
        config: {
          apiUrl: 'https://api.badminton.example/api/v1',
          variant: 'production',
          isProduction: true,
          appVersion: '1.0.0',
        },
      }));
      await SecureStore.setItemAsync('badminton.serverAddress', 'http://evil.example/api/v1');

      const production = require('./server-address') as typeof import('./server-address');

      // A field that redirects sign-in to any server is a phishing aid in an app real
      // accounts use. The store build talks only to its own API.
      expect(production.serverAddressEditable).toBe(false);
      await production.loadServerAddress();
      await production.setServerAddress('192.168.1.23:4000');
      expect(production.apiUrl()).toBe('https://api.badminton.example/api/v1');
    });
  });
});
