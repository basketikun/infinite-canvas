import assert from "node:assert/strict";

import { isImeComposing, isPlainEnterKey } from "../src/lib/keyboard-event";

type KeyboardEventLike = Parameters<typeof isPlainEnterKey>[0];

function enterEvent(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
    return {
        key: "Enter",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        ...overrides,
    };
}

assert.equal(isPlainEnterKey(enterEvent()), true, "plain Enter submits");
assert.equal(isPlainEnterKey(enterEvent({ shiftKey: true })), false, "Shift+Enter does not submit");
assert.equal(isPlainEnterKey(enterEvent({ ctrlKey: true })), false, "Ctrl+Enter does not submit");
assert.equal(isPlainEnterKey(enterEvent({ metaKey: true })), false, "Meta+Enter does not submit");
assert.equal(isPlainEnterKey(enterEvent({ nativeEvent: { isComposing: true } })), false, "IME composition Enter does not submit");
assert.equal(isPlainEnterKey(enterEvent({ nativeEvent: { keyCode: 229 } })), false, "legacy IME Enter does not submit");
assert.equal(isPlainEnterKey(enterEvent({ key: "a" })), false, "non-Enter keys do not submit");

assert.equal(isImeComposing(enterEvent({ isComposing: true })), true, "direct composition flag is detected");
assert.equal(isImeComposing(enterEvent({ nativeEvent: { isComposing: true } })), true, "native composition flag is detected");
assert.equal(isImeComposing(enterEvent({ keyCode: 229 })), true, "direct legacy keyCode composition is detected");
assert.equal(isImeComposing(enterEvent({ nativeEvent: { keyCode: 229 } })), true, "native legacy keyCode composition is detected");
assert.equal(isImeComposing(enterEvent()), false, "plain Enter is not composition");

console.log("ime keyboard tests passed");
