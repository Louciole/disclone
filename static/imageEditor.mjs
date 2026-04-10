/**
 * Image Editor Module
 * Handles image cropping with zoom and pan for profile pictures and banners
 * Supports both circular (avatar) and rectangular (banner) crop formats
 *
 * The crop preview stays FIXED in the center, while the IMAGE moves/scales.
 */

import global from "/static/framework/global.mjs"

class ImageEditor {
    constructor(canvasId = "imageCanvas") {
        this.canvasId = canvasId
        this.onEndDrag = null
        this.reset()
    }

    reset() {
        this.img = new Image()
        this.canvas = null
        this.ctx = null
        this.scale = 1
        this.offset = { x: 0, y: 0 } // Image offset in display pixels
        this.dragStart = null
        this.dragStartOffset = null
        this.cropRatio = 1 // width/height ratio: 1 = square, 3 = 3:1 banner, etc.
        this.isCircle = false // whether the crop overlay is shown as a circle
        this.imageRatio = 1 // width/height of source image
        this.baseDisplaySize = { width: 0, height: 0 } // Base displayed size at scale=1
        this.cropDisplaySize = { width: 0, height: 0 } // Crop zone size in display pixels
        this.isDragging = false
    }

    /**
     * Initialize editor with a new image file
     * @param {File} file - Image file to load
     * @param {number} cropRatio - Width/height ratio for crop area (1 = square, 3 = 3:1 banner)
     * @param {boolean} isCircle - Whether to render the crop overlay as a circle
     */
    init(file, cropRatio = 1, isCircle = false) {
        this.reset()
        this.cropRatio = cropRatio
        this.isCircle = isCircle

        return new Promise((resolve, reject) => {
            const reader = new FileReader()

            reader.onload = (e) => {
                this.img.onload = () => {
                    this.setupCanvas()
                    this.calculateSizes()
                    this.applyTransform()
                    this.updatePreviewCSS()
                    resolve()
                }
                this.img.onerror = reject
                this.img.src = e.target.result
            }
            reader.onerror = reject
            reader.readAsDataURL(file)
        })
    }

    setupCanvas() {
        this.canvas = document.getElementById(this.canvasId)
        this.ctx = this.canvas.getContext("2d")

        // Set canvas to image dimensions
        this.canvas.width = this.img.width
        this.canvas.height = this.img.height

        this.imageRatio = this.img.width / this.img.height

        // Draw the image
        this.ctx.drawImage(this.img, 0, 0)
    }

    calculateSizes() {
        const wrapper = this.canvas?.parentElement?.parentElement
        if (!wrapper) return

        // Get the wrapper size (constrained by CSS max-height/max-width)
        const wrapperRect = wrapper.getBoundingClientRect()

        // Calculate base display size for the image (fitting within wrapper)
        const maxWidth = wrapperRect.width || 400
        const maxHeight = 400 // 50vh approximation, CSS handles actual constraint

        if (this.imageRatio > maxWidth / maxHeight) {
            // Image is wider - width constrained
            this.baseDisplaySize.width = maxWidth
            this.baseDisplaySize.height = maxWidth / this.imageRatio
        } else {
            // Image is taller - height constrained
            this.baseDisplaySize.height = maxHeight
            this.baseDisplaySize.width = maxHeight * this.imageRatio
        }

        // Crop zone: largest rectangle with cropRatio that fits in base display
        if (this.cropRatio >= this.imageRatio) {
            // Crop is wider than image - width constrained
            this.cropDisplaySize.width = this.baseDisplaySize.width
            this.cropDisplaySize.height = this.baseDisplaySize.width / this.cropRatio
        } else {
            // Crop is taller than image - height constrained
            this.cropDisplaySize.height = this.baseDisplaySize.height
            this.cropDisplaySize.width = this.baseDisplaySize.height * this.cropRatio
        }
    }

    applyTransform() {
        if (!this.canvas) return

        // Apply scale and translation to the canvas via CSS transform
        // The image moves, the crop zone stays centered
        this.canvas.style.transform = `scale(${this.scale}) translate(${this.offset.x / this.scale}px, ${this.offset.y / this.scale}px)`
        this.canvas.style.transformOrigin = 'center center'
    }

    updatePreviewCSS() {
        const wrapper = this.canvas?.parentElement?.parentElement
        if (!wrapper) return

        // Set CSS custom properties for the fixed crop overlay
        wrapper.style.setProperty('--crop-width', this.cropDisplaySize.width + 'px')
        wrapper.style.setProperty('--crop-height', this.cropDisplaySize.height + 'px')

        // Crop zone is always centered
        const wrapperRect = wrapper.getBoundingClientRect()
        const cropX = (wrapperRect.width - this.cropDisplaySize.width) / 2
        const cropY = (wrapperRect.height - this.cropDisplaySize.height) / 2

        wrapper.style.setProperty('--crop-x', cropX + 'px')
        wrapper.style.setProperty('--crop-y', cropY + 'px')

        // Set shape class
        if (this.isCircle) {
            wrapper.classList.add('crop-circle')
            wrapper.classList.remove('crop-rect')
        } else {
            wrapper.classList.remove('crop-circle')
            wrapper.classList.add('crop-rect')
        }
    }

    /**
     * Handle pointer down (mouse or touch)
     */
    startDrag(event) {
        event.preventDefault()
        this.isDragging = true
        this.dragStart = { x: event.clientX, y: event.clientY }
        this.dragStartOffset = { ...this.offset }

        this.canvas.classList.add('dragging')
        this.canvas.setPointerCapture(event.pointerId)

        // Prevent menu from closing during drag
        global.state.disableClose = true

        // Bind events
        this.canvas.onpointermove = (e) => this.onDrag(e)
        this.canvas.onpointerup = (e) => this.endDrag(e)
        this.canvas.onpointercancel = (e) => this.endDrag(e)
    }

    /**
     * Handle pointer move during drag
     */
    onDrag(event) {
        if (!this.isDragging) return

        // Calculate delta from drag start (absolute positioning, no drift)
        const deltaX = event.clientX - this.dragStart.x
        const deltaY = event.clientY - this.dragStart.y

        // Calculate bounds: how far can the image move?
        // At scale=1, image fits exactly, so no movement allowed
        // At scale>1, image can move by (scaledSize - cropSize) / 2
        const scaledWidth = this.baseDisplaySize.width * this.scale
        const scaledHeight = this.baseDisplaySize.height * this.scale

        const maxOffsetX = Math.max(0, (scaledWidth - this.cropDisplaySize.width) / 2)
        const maxOffsetY = Math.max(0, (scaledHeight - this.cropDisplaySize.height) / 2)

        // Apply new offset with bounds
        this.offset.x = Math.max(-maxOffsetX, Math.min(maxOffsetX, this.dragStartOffset.x + deltaX))
        this.offset.y = Math.max(-maxOffsetY, Math.min(maxOffsetY, this.dragStartOffset.y + deltaY))

        this.applyTransform()
    }

    /**
     * Handle pointer up
     */
    endDrag(event) {
        if (!this.isDragging) return

        this.isDragging = false
        this.canvas.classList.remove('dragging')
        this.canvas.releasePointerCapture(event.pointerId)

        this.canvas.onpointermove = null
        this.canvas.onpointerup = null
        this.canvas.onpointercancel = null

        // Re-enable menu closing after a short delay
        setTimeout(() => {
            global.state.disableClose = false
            if (this.onEndDrag) this.onEndDrag()
        }, 50)
    }

    /**
     * Set zoom level
     * @param {number} newScale - Zoom scale (1 = 100%, 2 = 200%)
     */
    zoom(newScale) {
        const oldScale = this.scale
        this.scale = Math.max(1, Math.min(3, parseFloat(newScale)))

        // Adjust offset proportionally to keep the same crop center
        if (oldScale !== this.scale) {
            const scaleRatio = this.scale / oldScale
            this.offset.x *= scaleRatio
            this.offset.y *= scaleRatio
        }

        // Clamp offset to new bounds
        const scaledWidth = this.baseDisplaySize.width * this.scale
        const scaledHeight = this.baseDisplaySize.height * this.scale

        const maxOffsetX = Math.max(0, (scaledWidth - this.cropDisplaySize.width) / 2)
        const maxOffsetY = Math.max(0, (scaledHeight - this.cropDisplaySize.height) / 2)

        this.offset.x = Math.max(-maxOffsetX, Math.min(maxOffsetX, this.offset.x))
        this.offset.y = Math.max(-maxOffsetY, Math.min(maxOffsetY, this.offset.y))

        this.applyTransform()
    }

    /**
     * Get cropped image as base64
     * @param {number} outputSize - Optional fixed output size (width for banners, size for squares)
     * @param {string} format - Image format ('image/jpeg' or 'image/png')
     * @param {number} quality - JPEG quality (0-1), ignored for PNG
     * @returns {Promise<string>} Base64 encoded image
     */
    getCroppedImageData(outputSize = null, format = 'image/jpeg', quality = 0.85) {
        return new Promise((resolve, reject) => {
            if (!this.ctx || !this.img.complete) {
                reject(new Error('Image not loaded'))
                return
            }

            // Calculate the ratio between image pixels and display pixels
            const imgToDisplayRatio = this.img.width / this.baseDisplaySize.width

            // Crop size in image pixels (at current scale)
            const cropWidthImg = (this.cropDisplaySize.width / this.scale) * imgToDisplayRatio
            const cropHeightImg = (this.cropDisplaySize.height / this.scale) * imgToDisplayRatio

            // Offset in image pixels
            // Negative offset.x means image moved RIGHT, so crop window moved LEFT on image
            const offsetXImg = (-this.offset.x / this.scale) * imgToDisplayRatio
            const offsetYImg = (-this.offset.y / this.scale) * imgToDisplayRatio

            // Crop center is at image center + offset
            const centerX = this.img.width / 2 + offsetXImg
            const centerY = this.img.height / 2 + offsetYImg

            // Crop rectangle (top-left corner)
            const cropX = centerX - cropWidthImg / 2
            const cropY = centerY - cropHeightImg / 2

            // Output dimensions
            let outWidth, outHeight
            if (outputSize) {
                outWidth = outputSize
                outHeight = Math.round(outputSize / this.cropRatio)
            } else {
                outWidth = Math.round(cropWidthImg)
                outHeight = Math.round(cropHeightImg)
            }

            // Create output canvas
            const outCanvas = document.createElement('canvas')
            outCanvas.width = outWidth
            outCanvas.height = outHeight
            const outCtx = outCanvas.getContext('2d')

            // Draw cropped region
            outCtx.drawImage(
                this.img,
                cropX, cropY, cropWidthImg, cropHeightImg,
                0, 0, outWidth, outHeight
            )

            // Convert to base64
            outCanvas.toBlob((blob) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result)
                reader.onerror = reject
                reader.readAsDataURL(blob)
            }, format, quality)
        })
    }
}

// Create singleton instances
const imageEditor = new ImageEditor("imageCanvas")
export const emojiImageEditor = new ImageEditor("emojiCanvas")

// Expose to window for HTML onclick handlers
window.imageEditorStartDrag = (event) => imageEditor.startDrag(event)
window.imageEditorZoom = (value) => imageEditor.zoom(value)

// Export for module use
export default imageEditor
