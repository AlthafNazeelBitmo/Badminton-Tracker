import * as Network from 'expo-network';

/**
 * Whether the device can reach the internet.
 *
 * `isConnected` alone is not enough and is a common source of a confusing bug: a phone
 * joined to a café's wifi that has not been logged into is "connected" and can reach
 * nothing. `isInternetReachable` is the field that answers the question actually being
 * asked.
 *
 * It is also only ever a hint. The network can drop between the check and the request, so
 * nothing here is load-bearing — the sync engine treats a network failure as retryable
 * regardless of what this said a moment earlier. This exists to avoid pointless attempts
 * and to drive the "offline" indicator, not to decide correctness.
 */

export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    // `isInternetReachable` is undefined on platforms that cannot determine it. Assuming
    // reachable is the right default: a wasted attempt costs a failed request, whereas
    // assuming offline would stall the queue on a device that is perfectly fine.
    return Boolean(state.isConnected) && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

export type ConnectivityListener = (online: boolean) => void;

/**
 * Calls back when connectivity changes.
 *
 * The listener fires on any state change, including ones that do not alter reachability,
 * so the current value is compared before announcing anything. Without that, walking
 * between wifi and cellular would trigger a sync for every intermediate state.
 */
export function watchConnectivity(listener: ConnectivityListener): () => void {
  let previous: boolean | null = null;

  const subscription = Network.addNetworkStateListener((state) => {
    const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
    if (online === previous) return;
    previous = online;
    listener(online);
  });

  return () => subscription.remove();
}
