"""
Qt mouse and keyboard interaction handling for Pliable
"""

from pliable.geometry import calculate_push_pull_offset

class InteractionHandler:
    """Handles Qt mouse and keyboard events for 3D interaction"""

    def __init__(self, viewer):
        """
        Initialize interaction handler

        Args:
            viewer: PliableViewer instance with .canvas attribute
        """
        self.viewer = viewer
        self.canvas = viewer.canvas  # Direct reference to Qt widget!
        self.display = viewer.display

        # State tracking
        self.is_dragging = False
        self.drag_start_x = None
        self.drag_start_y = None
        self.last_preview_offset = None  # ← ADD THIS - track last preview

        # Hook into Qt events
        self._hook_mouse_events()

    def _hook_mouse_events(self):
        """Override Qt mouse event handlers"""
        print("Hooking Qt mouse events...")

        # Store original handlers
        self.original_mouse_press = self.canvas.mousePressEvent
        self.original_mouse_move = self.canvas.mouseMoveEvent
        self.original_mouse_release = self.canvas.mouseReleaseEvent

        # Override with our handlers
        self.canvas.mousePressEvent = self.on_mouse_press
        self.canvas.mouseMoveEvent = self.on_mouse_move
        self.canvas.mouseReleaseEvent = self.on_mouse_release

        print("✓ Qt mouse events hooked successfully!")

    def on_mouse_press(self, event):
        """Handle mouse button press"""
        from PyQt6.QtCore import Qt

        self.original_mouse_press(event)

        # Only track push/pull drag on LEFT button + SHIFT
        if (event.button() == Qt.MouseButton.LeftButton and
            event.modifiers() & Qt.KeyboardModifier.ShiftModifier):
            # Check if any face is selected
            has_face = any(shp.ShapeType() == 4 for shp in self.viewer.selected_shapes)
            if has_face:
                self.drag_start_x = event.position().x()
                self.drag_start_y = event.position().y()
                print(f"Shift+Left drag started - push/pull mode")
            else:
                print("No face selected - select a face first")  # ← Add feedback

    def on_mouse_move(self, event):
        """Handle mouse movement"""
        from PyQt6.QtCore import Qt

        # Check if we should start dragging (LEFT + SHIFT)
        if (not self.is_dragging and
            self.drag_start_y is not None and
            any(shp.ShapeType() == 4 for shp in self.viewer.selected_shapes) and
            event.buttons() & Qt.MouseButton.LeftButton and
            event.modifiers() & Qt.KeyboardModifier.ShiftModifier):

            current_y = event.position().y()
            delta_y = abs(self.drag_start_y - current_y)

            if delta_y > 3:
                self.is_dragging = True

                # Clear all highlights as soon as drag starts
                for ais_obj in self.viewer.highlighted_ais_objects:
                    self.viewer.display.Context.Erase(ais_obj, True)
                self.viewer.highlighted_ais_objects = []

                # Clear ALL selection highlighting (including edges)
                self.viewer.display.Context.ClearSelected(True)  # ← ADD THIS
                self.viewer.display.Context.UpdateCurrentViewer()

                print(f"Push/pull drag started! Delta: {delta_y:.1f}px")

        if self.is_dragging:
            # Get the selected face for push/pull
            selected_face = None
            for shp in self.viewer.selected_shapes:
                if shp.ShapeType() == 4:  # Face
                    selected_face = shp
                    break

            if selected_face is None:
                return

            # Calculate screen deltas
            current_x = event.position().x()
            current_y = event.position().y()
            delta_x = current_x - self.drag_start_x
            delta_y = current_y - self.drag_start_y

            # Calculate 3D offset
            offset = calculate_push_pull_offset(
                self.display,
                selected_face,
                self.viewer.cube,
                delta_x,
                delta_y
            )

            print(f"Drag: ΔX={delta_x:.1f}px, ΔY={delta_y:.1f}px → Offset={offset:.2f}mm")

            # Only update preview if offset changed significantly (>0.5mm)
            if (self.last_preview_offset is None or
                abs(offset - self.last_preview_offset) > 1.0):  # ← ADD THIS
                self.viewer.update_push_pull_preview(offset)
                self.last_preview_offset = offset

            return

        self.original_mouse_move(event)

    def on_mouse_release(self, event):
        """Handle mouse button release"""
        from PyQt6.QtCore import Qt

        if event.button() == Qt.MouseButton.LeftButton:
            if self.is_dragging:
                # Get the selected face
                selected_face = None
                for shp in self.viewer.selected_shapes:
                    if shp.ShapeType() == 4:  # Face
                        selected_face = shp
                        break

                if selected_face is not None:
                    current_x = event.position().x()
                    current_y = event.position().y()
                    delta_x = current_x - self.drag_start_x
                    delta_y = current_y - self.drag_start_y  # ← CHANGE THIS TOO

                    offset = calculate_push_pull_offset(
                        self.display,
                        selected_face,
                        self.viewer.cube,
                        delta_x,
                        delta_y
                    )

                    print(f"✓ Push/pull finished: {offset:.2f}mm")

                    # Finalize the operation
                    self.viewer.finalize_push_pull(offset)

            self.is_dragging = False
            self.drag_start_x = None
            self.drag_start_y = None
            self.last_preview_offset = None

        self.original_mouse_release(event)
