#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>

static NSURL *FindResourcesDirectory(void) {
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSURL *currentDirectory = [NSURL fileURLWithPath:fileManager.currentDirectoryPath isDirectory:YES];
    NSURL *executableURL = [NSURL fileURLWithPath:NSProcessInfo.processInfo.arguments.firstObject];
    NSURL *executableDirectory = executableURL.URLByDeletingLastPathComponent;

    NSArray<NSURL *> *candidates = @[
        [currentDirectory URLByAppendingPathComponent:@"Resources" isDirectory:YES],
        [executableDirectory URLByAppendingPathComponent:@"Resources" isDirectory:YES],
        [[executableDirectory URLByDeletingLastPathComponent] URLByAppendingPathComponent:@"Resources" isDirectory:YES]
    ];

    for (NSURL *candidate in candidates) {
        BOOL isDirectory = NO;
        if ([fileManager fileExistsAtPath:candidate.path isDirectory:&isDirectory] && isDirectory) {
            return candidate;
        }
    }

    return nil;
}

@interface PetWindow : NSWindow
@end

@implementation PetWindow
- (BOOL)canBecomeKeyWindow { return YES; }
@end

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, strong) PetWindow *window;
@property (nonatomic, strong) NSImageView *imageView;
@property (nonatomic, strong) NSArray<NSImage *> *idleFrames;
@property (nonatomic, strong) NSArray<NSImage *> *startFrames;
@property (nonatomic, strong) NSArray<NSImage *> *loopFrames;
@property (nonatomic, strong) NSArray<NSImage *> *currentFrames;
@property (nonatomic, strong) NSTimer *frameTimer;
@property (nonatomic, strong) dispatch_block_t idleBlock;
@property (nonatomic, strong) id globalMonitor;
@property (nonatomic, strong) id localMonitor;
@property (nonatomic, assign) NSUInteger frameIndex;
@property (nonatomic, assign) BOOL typing;
@property (nonatomic, assign) BOOL usingStartFrames;
@property (nonatomic, strong) NSURL *resourcesDirectory;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

    self.resourcesDirectory = FindResourcesDirectory();
    if (!self.resourcesDirectory) {
        NSLog(@"Missing Resources directory");
        [NSApp terminate:nil];
        return;
    }

    [self loadFrames];
    [self requestAccessibilityIfNeeded];
    [self buildWindow];
    [self startKeyboardMonitoring];
    [self showIdle];
    [self.window makeKeyAndOrderFront:nil];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)loadFrames {
    self.idleFrames = [self loadFramesAt:@"original_frames/static"];
    self.startFrames = [self loadFramesAt:@"original_frames/task_start"];
    self.loopFrames = [self loadFramesAt:@"original_frames/task_loop"];
}

- (NSArray<NSImage *> *)loadFramesAt:(NSString *)relativePath {
    NSURL *dir = [self.resourcesDirectory URLByAppendingPathComponent:relativePath isDirectory:YES];
    NSArray<NSURL *> *files = [[NSFileManager defaultManager] contentsOfDirectoryAtURL:dir
                                                             includingPropertiesForKeys:nil
                                                                                options:NSDirectoryEnumerationSkipsHiddenFiles
                                                                                  error:nil];
    NSArray<NSURL *> *sorted = [files sortedArrayUsingComparator:^NSComparisonResult(NSURL *a, NSURL *b) {
        return [a.lastPathComponent compare:b.lastPathComponent options:NSNumericSearch];
    }];

    NSMutableArray<NSImage *> *images = [NSMutableArray array];
    for (NSURL *url in sorted) {
        NSImage *image = [[NSImage alloc] initWithContentsOfURL:url];
        if (image) [images addObject:image];
    }
    return images.copy;
}

- (void)buildWindow {
    NSScreen *screen = NSScreen.mainScreen;
    NSRect visibleFrame = screen ? screen.visibleFrame : NSMakeRect(0, 0, 1440, 900);
    CGFloat width = 360.0;
    CGFloat height = 200.0;
    NSRect frame = NSMakeRect(NSMaxX(visibleFrame) - width - 20.0, NSMinY(visibleFrame) + 30.0, width, height);

    self.imageView = [[NSImageView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
    self.imageView.imageScaling = NSImageScaleProportionallyUpOrDown;

    self.window = [[PetWindow alloc] initWithContentRect:frame
                                               styleMask:NSWindowStyleMaskBorderless
                                                 backing:NSBackingStoreBuffered
                                                   defer:NO];
    self.window.opaque = NO;
    self.window.backgroundColor = NSColor.clearColor;
    self.window.level = NSStatusWindowLevel;
    self.window.hasShadow = NO;
    self.window.movableByWindowBackground = YES;
    self.window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                     NSWindowCollectionBehaviorFullScreenAuxiliary |
                                     NSWindowCollectionBehaviorStationary;
    self.window.contentView = self.imageView;
}

- (void)requestAccessibilityIfNeeded {
    NSDictionary *options = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES };
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}

- (void)startKeyboardMonitoring {
    __weak typeof(self) weakSelf = self;
    self.globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^(NSEvent *event) {
        [weakSelf handleKeyEvent:event];
    }];
    self.localMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent * _Nullable(NSEvent *event) {
        [weakSelf handleKeyEvent:event];
        return event;
    }];
}

- (void)handleKeyEvent:(NSEvent *)event {
    NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    if ((flags & NSEventModifierFlagCommand) || (flags & NSEventModifierFlagControl) || (flags & NSEventModifierFlagOption)) {
        return;
    }

    [self setTyping:YES];
    if (self.idleBlock) dispatch_block_cancel(self.idleBlock);
    __weak typeof(self) weakSelf = self;
    dispatch_block_t block = dispatch_block_create(0, ^{
        [weakSelf setTyping:NO];
    });
    self.idleBlock = block;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.8 * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
}

- (void)setTyping:(BOOL)typing {
    if (self.typing == typing) return;
    self.typing = typing;

    if (typing) {
        self.usingStartFrames = YES;
        [self playFrames:self.startFrames fps:30.0];
    } else {
        [self stopPlaying];
        [self showIdle];
    }
}

- (void)showIdle {
    if (self.idleFrames.count > 0) {
        self.imageView.image = self.idleFrames[0];
    }
}

- (void)playFrames:(NSArray<NSImage *> *)frames fps:(double)fps {
    [self stopPlaying];
    self.currentFrames = frames;
    self.frameIndex = 0;
    if (frames.count > 0) {
        self.imageView.image = frames[0];
    }
    self.frameTimer = [NSTimer scheduledTimerWithTimeInterval:(1.0 / fps)
                                                       target:self
                                                     selector:@selector(stepFrame)
                                                     userInfo:nil
                                                      repeats:YES];
}

- (void)stopPlaying {
    [self.frameTimer invalidate];
    self.frameTimer = nil;
}

- (void)stepFrame {
    if (self.currentFrames.count == 0) return;

    self.frameIndex += 1;
    if (self.frameIndex >= self.currentFrames.count) {
        if (self.typing && self.usingStartFrames) {
            self.usingStartFrames = NO;
            [self playFrames:self.loopFrames fps:24.0];
            return;
        }
        self.frameIndex = 0;
    }
    self.imageView.image = self.currentFrames[self.frameIndex];
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
