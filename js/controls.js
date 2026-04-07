// controls.js - Pointer-lock FPS controls
export class FPSControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.isLocked = false;

    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.sprint = false;
    this.jump = false;

    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.playerHeight = 1.7;
    this.speed = 12;
    this.sprintMultiplier = 1.8;
    this.jumpForce = 8;
    this.gravity = 20;
    this.onGround = true;
    this.verticalVelocity = 0;

    this.sensitivity = 0.002;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerlockChange = this._onPointerlockChange.bind(this);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onPointerlockChange);
  }

  lock() {
    this.domElement.requestPointerLock();
  }

  unlock() {
    document.exitPointerLock();
  }

  _onPointerlockChange() {
    this.isLocked = document.pointerLockElement === this.domElement;
  }

  _onMouseMove(e) {
    if (!this.isLocked) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= e.movementX * this.sensitivity;
    this.euler.x -= e.movementY * this.sensitivity;
    this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  }

  _onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': this.moveForward = true; break;
      case 'KeyS': this.moveBackward = true; break;
      case 'KeyA': this.moveLeft = true; break;
      case 'KeyD': this.moveRight = true; break;
      case 'ShiftLeft': case 'ShiftRight': this.sprint = true; break;
      case 'Space':
        if (this.onGround) {
          this.verticalVelocity = this.jumpForce;
          this.onGround = false;
        }
        break;
    }
  }

  _onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': this.moveForward = false; break;
      case 'KeyS': this.moveBackward = false; break;
      case 'KeyA': this.moveLeft = false; break;
      case 'KeyD': this.moveRight = false; break;
      case 'ShiftLeft': case 'ShiftRight': this.sprint = false; break;
    }
  }

  update(delta, colliders) {
    if (!this.isLocked) return;

    const speed = this.speed * (this.sprint ? this.sprintMultiplier : 1);

    // Horizontal movement
    this.direction.set(0, 0, 0);
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    if (this.moveForward) this.direction.add(forward);
    if (this.moveBackward) this.direction.sub(forward);
    if (this.moveRight) this.direction.add(right);
    if (this.moveLeft) this.direction.sub(right);
    this.direction.normalize();

    const moveVec = this.direction.multiplyScalar(speed * delta);

    // Attempt move with collision
    const newPos = this.camera.position.clone().add(moveVec);

    // Check collisions
    let blocked = false;
    if (colliders && colliders.length > 0) {
      const playerRadius = 0.4;
      for (const col of colliders) {
        if (!col.box) continue;
        // Expand box by player radius for collision
        const expanded = col.box.clone().expandByScalar(playerRadius);
        if (expanded.containsPoint(new THREE.Vector3(newPos.x, this.camera.position.y - this.playerHeight / 2, newPos.z))) {
          blocked = true;
          break;
        }
      }
    }

    if (!blocked) {
      this.camera.position.x = newPos.x;
      this.camera.position.z = newPos.z;
    }

    // Keep within level bounds
    const bound = 95;
    this.camera.position.x = Math.max(-bound, Math.min(bound, this.camera.position.x));
    this.camera.position.z = Math.max(-bound, Math.min(bound, this.camera.position.z));

    // Vertical (gravity + jump)
    this.verticalVelocity -= this.gravity * delta;
    this.camera.position.y += this.verticalVelocity * delta;

    if (this.camera.position.y <= this.playerHeight) {
      this.camera.position.y = this.playerHeight;
      this.verticalVelocity = 0;
      this.onGround = true;
    }
  }

  getPosition() {
    return this.camera.position.clone();
  }

  getDirection() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dir;
  }
}
