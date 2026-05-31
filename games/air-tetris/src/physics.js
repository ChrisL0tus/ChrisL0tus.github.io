const { Engine, Bodies, Composite, Runner } = Matter;

export class PhysicsWorld {
  constructor(width, height) {
    this.width  = width;
    this.height = height;

    this.engine = Engine.create({
      gravity: { x: 0, y: 1.1 },
      enableSleeping: true,   // lets idle pieces truly stop jittering
    });
    this.world = this.engine.world;

    this.runner = Runner.create({ delta: 1000 / 60 });
    Runner.run(this.runner, this.engine);

    this._buildWalls();
  }

  _buildWalls() {
    const T = 80;
    const w = this.width;
    const h = this.height;
    const opts = { isStatic: true, label: 'wall', restitution: 0.05, friction: 1.0, frictionStatic: 1.0 };

    Composite.add(this.world, [
      Bodies.rectangle(w / 2, h + T / 2,   w + T * 2, T, opts),  // floor
      Bodies.rectangle(-T / 2,   h / 2,    T, h * 3, opts),       // left wall
      Bodies.rectangle(w + T / 2, h / 2,   T, h * 3, opts),       // right wall
    ]);
  }

  add(body)    { Composite.add(this.world, body); }
  remove(body) { Composite.remove(this.world, body); }

  getPieces() {
    return Composite.allBodies(this.world).filter(b => b.label === 'piece');
  }
}
