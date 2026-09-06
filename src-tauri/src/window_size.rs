//! Where the main window is allowed to be.
//!
//! The app asks for a specific size on every start (see `lib::run`'s setup
//! hook), because the layout it grew into does not render at the size the
//! config used to open at. Asking is fine. Asking without looking at the
//! screen is what put the first-run window 224 px off the right edge and
//! 91 px below the bottom of a 1024x768 display, with the setup wizard's own
//! "Check again" button among the controls that fell off
//! (`docs/verification/first-run-2026-09-05.md`, Defect 1).
//!
//! The arithmetic lives here, separate from any window handle, for one
//! reason: it is the part that can be tested. The 1024x768 case cannot be
//! reproduced on the machine this is developed on, so the choice is between a
//! pure function with cases for every shape of screen and a claim that the
//! code looks right.

/// A size and a top-left position, in whatever unit went in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
}

/// The usable area of a monitor: its origin (which is not (0,0) on a second
/// monitor) and the size left after the taskbar and any docked bars.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorkArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Fit `requested` inside `work`, and centre it there.
///
/// Three rules, in this order, because they conflict and the order is the
/// decision:
///
/// 1. Never larger than the work area less `margin` on each side. The margin
///    is not decoration - a window exactly the width of the work area has its
///    resize edges under the screen edge, and on Windows the shadow makes it
///    look clipped.
/// 2. Never smaller than `min`, even when that does not fit. A window below
///    its minimum is one the layout cannot render, and the windowing system
///    would refuse the size anyway; better to overflow deliberately and put
///    the overflow where it can be dragged (the origin) than to hand the
///    platform a size it will silently ignore.
/// 3. Centred in the work area, and never starting before its origin. Rule 2
///    can produce something wider than the screen, and a centred oversize
///    window puts its left edge off the left of the display, where the title
///    bar cannot be grabbed.
///
/// `requested` smaller than the work area comes back untouched in size. This
/// is a clamp, not a resize: a large screen sees exactly the default it saw
/// before this existed.
pub fn clamp_to_work_area(
    work: WorkArea,
    requested: (f64, f64),
    min: (f64, f64),
    margin: f64,
) -> Placement {
    let (req_w, req_h) = requested;
    let (min_w, min_h) = min;

    // Rule 1, then rule 2. `max` after `min` is what makes the minimum win,
    // and the order matters: the other way round, a work area narrower than
    // the minimum would produce the work area's width.
    let width = req_w.min(work.width - margin * 2.0).max(min_w);
    let height = req_h.min(work.height - margin * 2.0).max(min_h);

    // Rule 3. `max(0.0)` is the oversize case: half of a negative gap is a
    // negative offset, which would push the left edge off the screen.
    let x = work.x + ((work.width - width) / 2.0).max(0.0);
    let y = work.y + ((work.height - height) / 2.0).max(0.0);

    Placement {
        width,
        height,
        x,
        y,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The size the app asks for, and the minimum it sets, both taken from
    /// `lib::run` rather than invented here. If those change, these cases
    /// should be read again rather than silently continuing to pass against
    /// numbers the app no longer uses.
    const REQUESTED: (f64, f64) = (1180.0, 820.0);
    const MIN: (f64, f64) = (720.0, 480.0);
    const MARGIN: f64 = 24.0;

    fn work(width: f64, height: f64) -> WorkArea {
        WorkArea {
            x: 0.0,
            y: 0.0,
            width,
            height,
        }
    }

    #[test]
    fn a_screen_with_room_to_spare_gets_the_default_size_unchanged() {
        // 1920x1080 less a 40px taskbar. The point of this case is that the
        // fix is not allowed to shrink anything that already worked.
        let p = clamp_to_work_area(work(1920.0, 1040.0), REQUESTED, MIN, MARGIN);
        assert_eq!(p.width, 1180.0);
        assert_eq!(p.height, 820.0);
        // and centred: (1920-1180)/2, (1040-820)/2
        assert_eq!(p.x, 370.0);
        assert_eq!(p.y, 110.0);
    }

    #[test]
    fn a_narrow_screen_loses_width_and_keeps_the_requested_height() {
        // 1152x864 with a taskbar: tall enough for 820, too narrow for 1180.
        let p = clamp_to_work_area(work(1152.0, 900.0), REQUESTED, MIN, MARGIN);
        assert_eq!(p.width, 1104.0, "1152 less 24 each side");
        assert_eq!(p.height, 820.0, "height had room and must not be touched");
        assert_eq!(p.x, 24.0);
        assert!(p.x + p.width <= 1152.0, "right edge is on the screen");
    }

    #[test]
    fn a_short_screen_loses_height_and_keeps_the_requested_width() {
        let p = clamp_to_work_area(work(1600.0, 720.0), REQUESTED, MIN, MARGIN);
        assert_eq!(p.width, 1180.0);
        assert_eq!(p.height, 672.0, "720 less 24 each side");
        assert_eq!(p.y, 24.0);
        assert!(p.y + p.height <= 720.0, "bottom edge is on the screen");
    }

    /// The case this module exists for, with the numbers off the VM.
    #[test]
    fn the_1024x768_first_run_window_fits_on_the_screen() {
        // 1024x768 with the Windows 11 taskbar, which is 48 logical px.
        let screen = work(1024.0, 720.0);
        let p = clamp_to_work_area(screen, REQUESTED, MIN, MARGIN);

        assert_eq!(p.width, 976.0);
        assert_eq!(p.height, 672.0);
        assert_eq!(p.x, 24.0);
        assert_eq!(p.y, 24.0);

        // Stated as the property rather than the arithmetic: every edge is
        // inside the work area. This is what was false on the VM.
        assert!(p.x >= screen.x, "left edge");
        assert!(p.y >= screen.y, "top edge");
        assert!(
            p.x + p.width <= screen.x + screen.width,
            "right edge: {} past {}",
            p.x + p.width,
            screen.x + screen.width
        );
        assert!(
            p.y + p.height <= screen.y + screen.height,
            "bottom edge: {} past {}",
            p.y + p.height,
            screen.y + screen.height
        );
    }

    #[test]
    fn a_work_area_smaller_than_the_minimum_gets_the_minimum_at_the_origin() {
        // 760x500 of work area. Less the margins that is 712x452, which is
        // below the minimum in both directions, and the minimum wins: a
        // window under it cannot draw its own layout, and the platform would
        // refuse the size regardless. So the margin is given up rather than
        // the content, and the result still fits on the screen.
        let p = clamp_to_work_area(work(760.0, 500.0), REQUESTED, MIN, MARGIN);
        assert_eq!(p.width, 720.0, "the minimum, not 712");
        assert_eq!(p.height, 480.0, "the minimum, not 452");
        assert_eq!(p.x, 20.0, "centred in what is left, with no margin to give");
        assert_eq!(p.y, 10.0);
        assert!(p.x + p.width <= 760.0);
        assert!(p.y + p.height <= 500.0);
    }

    #[test]
    fn a_work_area_narrower_than_the_minimum_starts_at_the_origin() {
        // Narrower than the minimum in both directions: nothing can be
        // centred, so the window starts at the work area's own corner rather
        // than at a negative offset that would hide the title bar.
        let p = clamp_to_work_area(work(640.0, 400.0), REQUESTED, MIN, MARGIN);
        assert_eq!(p.width, 720.0);
        assert_eq!(p.height, 480.0);
        assert_eq!(p.x, 0.0);
        assert_eq!(p.y, 0.0);
    }

    #[test]
    fn a_second_monitor_is_positioned_in_its_own_coordinates() {
        // A work area whose origin is not (0,0) - a monitor to the right of
        // the primary. Centring has to be relative to that origin, or the
        // window lands on the wrong screen.
        let p = clamp_to_work_area(
            WorkArea {
                x: 1920.0,
                y: -180.0,
                width: 1024.0,
                height: 720.0,
            },
            REQUESTED,
            MIN,
            MARGIN,
        );
        assert_eq!(p.width, 976.0);
        assert_eq!(p.x, 1944.0, "1920 + 24");
        assert_eq!(p.y, -156.0, "-180 + 24");
    }

    /// The configured minimum has to be small enough for the clamp to have
    /// anywhere to go on the screen this was found on. If somebody raises it
    /// past the work area of a 1024x768 display, the clamp cannot work and
    /// this says so here rather than on a user's machine.
    #[test]
    fn the_minimum_size_leaves_the_clamp_somewhere_to_go_on_1024x768() {
        let (min_w, min_h) = MIN;
        assert!(
            min_w + MARGIN * 2.0 <= 1024.0,
            "minimum width {min_w} plus margins does not fit 1024"
        );
        assert!(
            min_h + MARGIN * 2.0 <= 720.0,
            "minimum height {min_h} plus margins does not fit a 1024x768 work area"
        );
    }
}
