// Loading code does not join a room, request microphone access, or start an agent.
let pending: Promise<typeof import("livekit-client")> | undefined;
export function loadVoiceSdk() {
  if (!pending) pending = import("livekit-client").catch(error => {
    pending = undefined; // A failed preload must not poison the actual connection.
    throw error;
  });
  return pending;
}
export function preloadVoiceSdk() {
  void loadVoiceSdk().catch(() => {});
}
