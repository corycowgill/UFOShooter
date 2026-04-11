// controls.js - Pointer-lock FPS controls + Xbox controller support
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

    // Gamepad state
    this.gamepadIndex = -1;
    this.gamepadLookX = 0;
    this.gamepadLookY = 0;
    this.gamepadMoveX = 0;
    this.gamepadMoveY = 0;
    this.gamepadSensitivity = 3.0;
    this.gamepadDeadzone = 0.15;
    this.gamepadButtons = {};
    this.gamepadButtonsPrev = {};
    // Callbacks for gamepad button actions (set by main.js)
    this.onGamepadFire = null;
    this.onGamepadZoom = null;
    this.onGamepadWeapon1 = null;
    this.onGamepadWeapon2 = null;
    this.onGamepadWeapon3 = null;
    this.onGamepadHelp = null;
    this.onGamepadStart = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerlockChange = this._onPointerlockChange.bind(this);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onPointerlockChange);

    // Gamepad connect/disconnect
    window.addEventListener('gamepadconnected', (e) => {
      console.log('Gamepad connected:', e.gamepad.id);
      this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      console.log('Gamepad disconnected:', e.gamepad.id);
      if (e.gamepad.index === this.gamepadIndex) {
        this.gamepadIndex = -1;
      }
    });
  }

  get hasGamepad() {
    return this.gamepadIndex >= 0;
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

  // Apply deadzone to analog stick value
  _applyDeadzone(value) {
    if (Math.abs(value) < this.gamepadDeadzone) return 0;
    const sign = value > 0 ? 1 : -1;
    return sign * (Math.abs(value) - this.gamepadDeadzone) / (1 - this.gamepadDeadzone);
  }

  // Returns true if button was just pressed this frame (not held)
  gamepadPressed(buttonIndex) {
    return this.gamepadButtons[buttonIndex] && !this.gamepadButtonsPrev[buttonIndex];
  }

  // Poll gamepad state each frame
  _pollGamepad(delta) {
    if (this.gamepadIndex < 0) return;
    const gamepads = navigator.getGamepads();
    const gp = gamepads[this.gamepadIndex];
    if (!gp) return;

    // Save previous button state for edge detection
    this.gamepadButtonsPrev = { ...this.gamepadButtons };
    this.gamepadButtons = {};
    for (let i = 0; i < gp.buttons.length; i++) {
      this.gamepadButtons[i] = gp.buttons[i].pressed;
    }

    // Xbox controller standard mapping:
    // Axes: 0=LeftStickX, 1=LeftStickY, 2=RightStickX, 3=RightStickY
    // Buttons:
    //  0=A, 1=B, 2=X, 3=Y
    //  4=LB, 5=RB
    //  6=LT, 7=RT
    //  8=Back/Select, 9=Start
    //  10=LeftStickPress, 11=RightStickPress
    //  12=DPadUp, 13=DPadDown, 14=DPadLeft, 15=DPadRight

    // Left stick -> movement
    this.gamepadMoveX = this._applyDeadzone(gp.axes[0]);
    this.gamepadMoveY = this._applyDeadzone(gp.axes[1]);

    // Right stick -> look
    this.gamepadLookX = this._applyDeadzone(gp.axes[2]);
    this.gamepadLookY = this._applyDeadzone(gp.axes[3]);

    // Sprint = Left Stick Press (L3)
    this.sprint = this.sprint || gp.buttons[10]?.pressed;

    // Jump = A button
    if (this.gamepadPressed(0) && this.onGround) {
      this.verticalVelocity = this.jumpForce;
      this.onGround = false;
    }

    // RT (7) = Fire
    if (this.gamepadPressed(7) && this.onGamepadFire) {
      this.onGamepadFire();
    }
    // Also support holding RT for automatic fire
    if (gp.buttons[7]?.pressed && this.onGamepadFireHold) {
      this.onGamepadFireHold();
    }

    // LT (6) = Zoom/ADS
    if (this.gamepadPressed(6) && this.onGamepadZoom) {
      this.onGamepadZoom();
    }

    // Weapon switching: DPad Left/Up/Right or X/Y/B
    if (this.gamepadPressed(14) && this.onGamepadWeapon1) this.onGamepadWeapon1(); // DPad Left
    if (this.gamepadPressed(12) && this.onGamepadWeapon2) this.onGamepadWeapon2(); // DPad Up
    if (this.gamepadPressed(15) && this.onGamepadWeapon3) this.onGamepadWeapon3(); // DPad Right

    // Also: Y = cycle weapon forward
    if (this.gamepadPressed(3) && this.onGamepadCycleWeapon) {
      this.onGamepadCycleWeapon();
    }

    // Back/Select (8) = Help
    if (this.gamepadPressed(8) && this.onGamepadHelp) {
      this.onGamepadHelp();
    }

    // Start (9) = Pause / Start game
    if (this.gamepadPressed(9) && this.onGamepadStart) {
      this.onGamepadStart();
    }

    // B (1) = close help / back
    if (this.gamepadPressed(1) && this.onGamepadBack) {
      this.onGamepadBack();
    }

    // Apply right stick look
    if (this.gamepadLookX !== 0 || this.gamepadLookY !== 0) {
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= this.gamepadLookX * this.gamepadSensitivity * delta;
      this.euler.x -= this.gamepadLookY * this.gamepadSensitivity * delta;
      this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    }
  }

  update(delta, colliders) {
    // Always poll gamepad
    this._pollGamepad(delta);

    // Allow gamepad to work even without pointer lock
    const useGamepad = this.hasGamepad;
    if (!this.isLocked && !useGamepad) return;

    const speed = this.speed * (this.sprint ? this.sprintMultiplier : 1);

    // Horizontal movement
    this.direction.set(0, 0, 0);
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    // Keyboard input
    if (this.moveForward) this.direction.add(forward);
    if (this.moveBackward) this.direction.sub(forward);
    if (this.moveRight) this.direction.add(right);
    if (this.moveLeft) this.direction.sub(right);

    // Gamepad left stick input (additive with keyboard)
    if (useGamepad && (this.gamepadMoveX !== 0 || this.gamepadMoveY !== 0)) {
      this.direction.add(right.clone().multiplyScalar(this.gamepadMoveX));
      this.direction.sub(forward.clone().multiplyScalar(this.gamepadMoveY));
    }

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
