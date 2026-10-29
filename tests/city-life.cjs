const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const elements = new Map();
const defaults = {speed:'650', semantic:'restaurant', object:'robot', target:'r1', frame:'world', distanceFrom:'robot', distanceTo:'point', ax:'15', ay:'11', bx:'16', by:'21', qx:'16', qy:'21'};
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: defaults[id] || '', style: {}, checked: true,
    setAttribute() {}, classList: {toggle() {}}, click() { this.onclick?.(); }
  });
  return elements.get(id);
}
let seed = 123;
const seededMath = Object.create(Math);
seededMath.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const intervals = [];
const context = {document: {getElementById: element, querySelector: () => element('side')}, window: {}, Math: seededMath, console, setInterval: (callback, delay) => { intervals.push({callback, delay}); return intervals.length; }, clearInterval() {}};
vm.createContext(context);
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const sim = context.window.citySimulation;
const lifeClock = intervals.find(timer => Math.abs(timer.delay - 1000/30) < .001);
assert(lifeClock, 'Street actors must start their own clock on page load.');
function advanceLife(steps) { for(let i=0;i<steps;i++) lifeClock.callback(); }
function assertActorsRoamWithoutMovingDog() {
  const before=sim.snapshot();
  const visited=new Map([['rat',new Set()],...before.pedestrians.map(p=>[p.id,new Set()])]);
  for(let i=0;i<120;i++) {
    advanceLife(1);
    const current=sim.snapshot();
    for(const actor of [{...current.rat,id:'rat'},...current.pedestrians]) {
      assert.equal(sim.world[Math.round(actor.y)][Math.round(actor.x)], 'road');
      visited.get(actor.id).add(actor.x+','+actor.y);
    }
    assert.equal(current.x,before.x);
    assert.equal(current.y,before.y);
    assert.equal(current.tick,before.tick);
    assert.equal(current.energy,before.energy);
  }
  for(const [id,positions] of visited) assert(positions.size>1, id+' must keep walking');
}

// Rat directly crosses the route: leap over its cell and land on the route.
sim.setDestination({x:16,y:18});
sim.step();
let state = sim.snapshot();
assert(state.jump);
assert.equal(state.jump.from.y, 21);
assert.equal(state.jump.over.y, 20);
assert.equal(state.jump.to.y, 19);
assert.equal(state.y, 19);
assert.equal(state.energy, 59); // Two traversed cells still consume two cells of energy.
assert(state.jump.duration > 0);
sim.step();
assert.equal(sim.snapshot().state, 'Arrived');
assert.equal(sim.snapshot().y, 18);

// Greeting uses nearby reachable people, and clears away from them.
sim.reset();
assert.equal(sim.snapshot().greeting, true);
element('distanceDemo').click();
assert.equal(sim.snapshot().greeting, false);

// A manually selected dock charges to full and stops.
sim.reset();
sim.setDestination({x:16,y:21});
assert.equal(sim.snapshot().state, 'Charging');
assert.equal(sim.snapshot().charging, true);
let previous = sim.snapshot().energy;
for (let i=0; i<3; i++) {
  sim.step();
  state = sim.snapshot();
  assert(state.energy > previous);
  previous = state.energy;
}
assert.equal(state.energy, 100);
assert.equal(state.state, 'Arrived');
assert.equal(state.charging, false);
assert.equal(element('play').textContent, 'Start');

// Everyone wanders only on roads; deliveries and automatic charging still finish.
sim.reset();
let sawCharge = false, ratMoved = false;
for (let i=0; i<1500 && sim.snapshot().state !== 'Complete'; i++) {
  sim.step();
  advanceLife(2);
  state = sim.snapshot();
  for (const actor of [state.rat, ...state.pedestrians]) assert.equal(sim.world[Math.round(actor.y)][Math.round(actor.x)], 'road');
  if (state.rat.x !== 16 || state.rat.y !== 20) ratMoved = true;
  if (state.charging) sawCharge = true;
  assert.notEqual(state.state, 'Out of power');
}
assert(ratMoved);
assert(sawCharge);
assert.equal(state.order, 3);
assert.equal(state.state, 'Complete');
sim.reset();
assert.equal(sim.snapshot().rat.x, 16);
assert.equal(sim.snapshot().rat.y, 20);
assert.equal(sim.snapshot().jump, null);
assert.equal(sim.snapshot().energy, 60);
// Street life continues before Start, during Pause, at a destination and while charging.
sim.reset();
assertActorsRoamWithoutMovingDog();
element('play').click();
element('play').click();
assert.equal(element('play').textContent,'Start');
assertActorsRoamWithoutMovingDog();
sim.reset();
sim.setDestination({x:16,y:18});
for(let i=0;i<4&&sim.snapshot().state!=='Arrived';i++)sim.step();
assert.equal(sim.snapshot().state,'Arrived');
assertActorsRoamWithoutMovingDog();
sim.reset();
sim.setDestination({x:16,y:21});
assert.equal(sim.snapshot().state,'Charging');
assertActorsRoamWithoutMovingDog();
// Motion stays continuous and off-grid, including at turns near building corners.
sim.reset();
let diagonalSteps=0,offGridSteps=0,restFrames=0;
for(let frame=0;frame<2400;frame++) {
  const before=sim.snapshot();advanceLife(1);const after=sim.snapshot();
  const oldActors=[before.rat,...before.pedestrians],newActors=[after.rat,...after.pedestrians];
  for(let i=0;i<newActors.length;i++) {
    const a=newActors[i],b=oldActors[i],dx=a.x-b.x,dy=a.y-b.y;
    assert(Number.isFinite(a.x)&&Number.isFinite(a.y));
    assert(Math.hypot(dx,dy)<=(i===0?2.7:1.3)/30+1e-8,'No teleporting between waypoints');
    if(Math.abs(dx)>.001&&Math.abs(dy)>.001)diagonalSteps++;
    if(Math.abs(a.x-Math.round(a.x))>.01&&Math.abs(a.y-Math.round(a.y))>.01)offGridSteps++;
    if(a.rest>0)restFrames++;
    const radius=i===0?.3:.21;
    assert(a.x>=-.5+radius&&a.x<=sim.W-.5-radius&&a.y>=-.5+radius&&a.y<=sim.H-.5-radius);
    for(const block of sim.campusBlocks) {
      const ox=Math.max(block.x-.5-a.x,0,a.x-(block.x+block.w-.5));
      const oy=Math.max(block.y-.5-a.y,0,a.y-(block.y+block.d-.5));
      assert(ox*ox+oy*oy>radius*radius-1e-9,'Actor body must stay outside buildings');
    }
  }
}
assert(diagonalSteps>1000);
assert(offGridSteps>1000);
assert(restFrames>0);
console.log('PASS: continuous off-grid movement, speed bounds, 80 seconds of wall clearance, natural pauses, independent roaming, proximity reactions, charging, reset and deliveries.');
