// Keep the lower third on the frame held by the native output during navigation.
// This is transient presentation state, never a second queue or saved checkpoint.
export class OverlayPresentation {
  constructor(current, clock) {
    this.current = current ? {...current} : null;
    this.clock = clock;
    this.ready = null;
  }
  acknowledge(state, report) {
    if (!state.current || report.generation !== state.generation || report.videoId !== state.current.videoId) return false;
    if (report.displayReady !== true && report.revealDisplay !== true) return false;
    if (this.ready?.generation !== state.generation) this.ready = {generation: state.generation, at: this.clock() + 300};
    return true;
  }
  snapshot(state, synchronized) {
    if (!synchronized || !state.current || (this.ready?.generation === state.generation && this.clock() >= this.ready.at)) {
      this.current = state.current ? {...state.current} : null;
    } else if (this.current?.id === state.current.id && this.current?.videoId === state.current.videoId) {
      // Title discovery and settings edits on the visible item remain immediate.
      this.current = {...state.current};
    }
    return this.current;
  }
}
