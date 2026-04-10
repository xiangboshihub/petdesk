#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>

@interface KeyMonitor : NSObject {
    BOOL _keyStates[128];
}
@property (nonatomic, strong) dispatch_block_t idleBlock;
@property (nonatomic, strong) NSTimer *pollTimer;
@property (nonatomic, assign) BOOL typing;
@end

static const NSTimeInterval kPollInterval = 0.008;
static const NSTimeInterval kIdleDelay = 0.7;

@implementation KeyMonitor

- (BOOL)isModifierKeyCode:(CGKeyCode)keyCode {
    switch (keyCode) {
        case 54:  // right command
        case 55:  // left command
        case 56:  // left shift
        case 57:  // caps lock
        case 58:  // left option
        case 59:  // left control
        case 60:  // right shift
        case 61:  // right option
        case 62:  // right control
        case 63:  // fn
            return YES;
        default:
            return NO;
    }
}

- (void)pollKeyboardState {
    BOOL hasActiveKey = NO;

    for (CGKeyCode keyCode = 0; keyCode < 128; keyCode++) {
        if ([self isModifierKeyCode:keyCode]) {
            continue;
        }

        BOOL isPressed = CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, keyCode);
        if (isPressed && !_keyStates[keyCode]) {
            _keyStates[keyCode] = YES;
            [self handleKeyDown];
            fprintf(stdout, "key\n");
            fflush(stdout);
        } else if (!isPressed && _keyStates[keyCode]) {
            _keyStates[keyCode] = NO;
        }

        if (isPressed) {
            hasActiveKey = YES;
        }
    }

    if (hasActiveKey) {
        return;
    }
}

- (void)start {
    self.pollTimer = [NSTimer scheduledTimerWithTimeInterval:kPollInterval
                                                      target:self
                                                    selector:@selector(pollKeyboardState)
                                                    userInfo:nil
                                                     repeats:YES];
}

- (void)handleKeyDown {
    [self setTypingState:YES];
    if (self.idleBlock) {
        dispatch_block_cancel(self.idleBlock);
    }

    __weak typeof(self) weakSelf = self;
    dispatch_block_t block = dispatch_block_create(0, ^{
        [weakSelf setTypingState:NO];
    });
    self.idleBlock = block;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kIdleDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
}

- (void)setTypingState:(BOOL)typing {
    if (self.typing == typing) {
        return;
    }
    self.typing = typing;
    fprintf(stdout, "%s\n", typing ? "typing" : "idle");
    fflush(stdout);
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        KeyMonitor *monitor = [[KeyMonitor alloc] init];
        [monitor start];
        [[NSRunLoop currentRunLoop] run];
    }
    return 0;
}
