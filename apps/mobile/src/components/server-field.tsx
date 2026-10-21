import { useState } from 'react';
import { Field } from './ui';
import {
  InvalidServerAddressError,
  displayServerAddress,
  serverAddressEditable,
  setServerAddress,
} from '@/lib/server-address';
import { NetworkError, describeError } from '@/lib/api/errors';

/**
 * The "Server" field on the sign-in and registration screens, for preview builds.
 *
 * Returns nothing in a store build, where the address is fixed.
 */
export function useServerField() {
  const [value, setValue] = useState(displayServerAddress());
  const [error, setError] = useState<string | null>(null);

  /** Applies the typed address. Returns false, with the field marked, if it is not usable. */
  const apply = async (): Promise<boolean> => {
    if (!serverAddressEditable) return true;
    setError(null);
    try {
      await setServerAddress(value);
      return true;
    } catch (failure) {
      if (failure instanceof InvalidServerAddressError) {
        setError(failure.message);
        return false;
      }
      throw failure;
    }
  };

  /**
   * A sign-in failure, explained.
   *
   * The generic offline message — "your changes are saved on this device" — is meaningless
   * on a sign-in screen. Here, failing to connect almost always means a wrong address or a
   * phone on a different network, so the message names the address it tried.
   */
  const explain = (failure: unknown): string => {
    if (failure instanceof NetworkError) {
      return serverAddressEditable
        ? `Could not reach ${displayServerAddress()}. Check the address, that the API is running, and that this phone is on the same Wi-Fi.`
        : 'Could not reach the server. Check your connection and try again.';
    }
    return describeError(failure);
  };

  const field = serverAddressEditable ? (
    <Field
      label="Server"
      value={value}
      onChangeText={setValue}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      placeholder="192.168.1.23:4000"
      hint="The address of the computer running the API, on this Wi-Fi."
      error={error}
    />
  ) : null;

  return { field, apply, explain };
}
