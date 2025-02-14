/**
 * Manages the progress bar animation and state
 */
export class ProgressManager {
    constructor(progressBar) {
        this.progressBar = progressBar;
        this.currentProgress = 0;
        this.targetProgress = 0;
        this.animationFrame = null;
        this.minStep = 0.5; // Minimum percentage step per frame
    }

    /**
     * Animate the progress bar
     */
    animate() {
        const difference = this.targetProgress - this.currentProgress;
        const step = Math.max(this.minStep, Math.abs(difference) * 0.15);

        this.currentProgress += difference > 0 ? step : -step;
        this.currentProgress = Math[difference > 0 ? 'min' : 'max'](
            this.currentProgress, 
            this.targetProgress
        );

        if (this.progressBar) {
            this.progressBar.style.width = `${this.currentProgress}%`;
        }

        if (Math.abs(this.targetProgress - this.currentProgress) > 0.1) {
            this.animationFrame = requestAnimationFrame(this.animate.bind(this));
        } else {
            this.currentProgress = this.targetProgress;
            if (this.progressBar) {
                this.progressBar.style.width = `${this.targetProgress}%`;
            }
            this.animationFrame = null;
        }
    }

    /**
     * Set progress percentage
     * @param {number} percentage - Target percentage (0-100)
     */
    setProgress(percentage) {
        this.targetProgress = Math.min(100, Math.max(0, percentage));
        if (!this.animationFrame) {
            this.animate();
        }
    }

    /**
     * Complete the progress bar
     */
    complete() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        this.currentProgress = 100;
        this.targetProgress = 100;
        if (this.progressBar) {
            this.progressBar.style.width = '100%';
        }
    }

    /**
     * Reset the progress bar
     */
    reset() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        this.currentProgress = 0;
        this.targetProgress = 0;
        if (this.progressBar) {
            this.progressBar.style.width = '0%';
        }
    }
}