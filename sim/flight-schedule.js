// Pure integer-tick flight geometry/schedule. Not wired into world ticks yet.
// Ground BFS keeps its existing N/E/S/W path and walkability contract.
const integer = (n, name, min = 0) => {
  if (!Number.isSafeInteger(n) || n < min) throw new RangeError(name);
  return n;
};
const point = p => {
  integer(p?.x, 'x'); integer(p?.y, 'y');
};

export function airDistance(from, to) {
  point(from); point(to);
  const dx = to.x - from.x, dy = to.y - from.y, squared = dx * dx + dy * dy;
  integer(squared, 'squared distance');
  return Math.ceil(Math.sqrt(squared));
}

// Logical position is a straight segment sampled onto integer map coordinates.
// No terrain query, walking-path allocation, random draw or map mutation.
export function flightPosition(from, to, elapsed, duration) {
  point(from); point(to);
  integer(duration, 'duration', 1); integer(elapsed, 'elapsed');
  if (elapsed > duration) throw new RangeError('elapsed exceeds duration');
  const interpolate = (a, b) => {
    const numerator = a * (duration - elapsed) + b * elapsed;
    integer(numerator, 'position numerator');
    const whole = Math.floor(numerator / duration), remainder = numerator % duration;
    return whole + (remainder >= Math.ceil(duration / 2) ? 1 : 0);
  };
  return { x: interpolate(from.x, to.x), y: interpolate(from.y, to.y) };
}

function timing(link) {
  integer(link.openedTick, 'openedTick');
  integer(link.serviceEpochTick ?? link.openedTick, 'serviceEpochTick');
  integer(link.pausedTicks ?? 0, 'pausedTicks');
  integer(link.speed, 'speed', 1); integer(link.dwellTicks, 'dwellTicks', 1);
  if (link.from === link.to) throw new RangeError('distinct airports required');
  const distance = airDistance(link.fromPoint, link.toPoint);
  if (!distance) throw new RangeError('distinct airport positions required');
  const rideTicks = Math.ceil(distance / link.speed), dwell = link.dwellTicks;
  const period = integer(2 * (dwell + rideTicks), 'period', 1);
  return { rideTicks, dwell, period };
}

// openedTick: docked at from; departure tick: still at the gate, boarding ends.
// First airborne movement is departure+1; destination arrival is departure+ride.
// A paused route uses persisted pausedTicks, never wall time or missed-flight bursts.
export function flightServiceAt(link, tick) {
  integer(tick, 'tick');
  const { rideTicks, dwell, period } = timing(link);
  const clock = tick - (link.serviceEpochTick ?? link.openedTick) - (link.pausedTicks ?? 0);
  if (clock < 0) return null;
  const phase = clock % period;
  if (phase <= dwell) return { kind: 'docked', airportId: link.from,
    position: { ...link.fromPoint }, departure: phase === dwell };
  if (phase < dwell + rideTicks) return { kind: 'flying', from: link.from, to: link.to,
    position: flightPosition(link.fromPoint, link.toPoint, phase - dwell, rideTicks) };
  if (phase <= 2 * dwell + rideTicks) return { kind: 'docked', airportId: link.to,
    position: { ...link.toPoint }, departure: phase === 2 * dwell + rideTicks };
  return { kind: 'flying', from: link.to, to: link.from,
    position: flightPosition(link.toPoint, link.fromPoint, phase - 2 * dwell - rideTicks, rideTicks) };
}

// Query only: seats are allocated later from the real gate queue, not here.
// readyTick already includes access/transfer dwell. Exact departure-tick arrivals
// are eligible if the caller processes gate arrivals before departure allocation.
export function nextFlight(link, from, readyTick) {
  integer(readyTick, 'readyTick');
  const { rideTicks, dwell, period } = timing(link);
  if (link.blocked || (from !== link.from && from !== link.to)) return null;
  const reverse = from === link.to;
  const first = integer((link.serviceEpochTick ?? link.openedTick) + (link.pausedTicks ?? 0)
    + (reverse ? 2 * dwell + rideTicks : dwell), 'first departure');
  const cycles = Math.max(0, Math.ceil((readyTick - first) / period));
  const departureTick = integer(first + cycles * period, 'departureTick');
  const arrivalTick = integer(departureTick + rideTicks, 'arrivalTick');
  return { linkId: link.id, from, to: reverse ? link.from : link.to,
    departureTick, arrivalTick, rideTicks, waitTicks: departureTick - readyTick };
}
