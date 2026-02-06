"""
Qt mouse and keyboard interaction handling for Pliable
"""

from pliable.geometry import calculate_push_pull_offset, calculate_fillet_chamfer_radius

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
        # print("Hooking Qt mouse events...")

        # Store original handlers
        self.original_mouse_press = self.canvas.mousePressEvent
        self.original_mouse_move = self.canvas.mouseMoveEvent
        self.original_mouse_release = self.canvas.mouseReleaseEvent

        # Override with our handlers
        self.canvas.mousePressEvent = self.on_mouse_press
        self.canvas.mouseMoveEvent = self.on_mouse_move
        self.canvas.mouseReleaseEvent = self.on_mouse_release

        # print("✓ Qt mouse events hooked successfully!")

    def on_mouse_press(self, event):
        """Handle mouse button press"""
        from PyQt6.QtCore import Qt

        self.original_mouse_press(event)

        # Only track operations on LEFT button + SHIFT
        if (event.button() == Qt.MouseButton.LeftButton and
            event.modifiers() & Qt.KeyboardModifier.ShiftModifier):

            # Analyze current selection
            has_faces = any(shp.ShapeType() == 4 for shp in self.viewer.selected_shapes)
            has_edges = any(shp.ShapeType() == 6 for shp in self.viewer.selected_shapes)
            has_vertices = any(shp.ShapeType() == 7 for shp in self.viewer.selected_shapes)

            # Validate selection type
            if not self.viewer.selected_shapes:
                msg = "No selection - select a face or edge first"
                # print(msg)
                if hasattr(self.viewer, 'parent_window') and self.viewer.parent_window is not None:
                    self.viewer.parent_window.show_status_message(msg)
            elif has_faces and (has_edges or has_vertices):
                msg = "Mixed selection - select only faces OR only edges"
                # print(msg)
                if hasattr(self.viewer, 'parent_window') and self.viewer.parent_window is not None:
                    self.viewer.parent_window.show_status_message(msg)
            elif has_vertices:
                msg = "Vertex operations not yet supported"
                # print(msg)
                if hasattr(self.viewer, 'parent_window') and self.viewer.parent_window is not None:
                    self.viewer.parent_window.show_status_message(msg)
            elif has_faces:
                # Valid face selection - allow push/pull drag
                self.drag_start_x = event.position().x()
                self.drag_start_y = event.position().y()
                # print(f"Shift+Left drag started - push/pull mode")
                if hasattr(self.viewer, 'parent_window') and self.viewer.parent_window is not None:
                    self.viewer.parent_window.show_status_message("Push/pull drag started")
            elif has_edges:
                # Valid edge selection - allow fillet/chamfer drag
                self.drag_start_x = event.position().x()
                self.drag_start_y = event.position().y()
                # print(f"Shift+Left drag started - fillet/chamfer mode")
                if hasattr(self.viewer, 'parent_window') and self.viewer.parent_window is not None:
                    self.viewer.parent_window.show_status_message("Fillet/chamfer drag started")

    def on_mouse_move(self, event):
        """Handle mouse movement"""
        from PyQt6.QtCore import Qt

        # Check if we should start dragging (LEFT + SHIFT)
        if (not self.is_dragging and
            self.drag_start_y is not None and
            len(self.viewer.selected_shapes) > 0 and
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
                self.viewer.display.Context.ClearSelected(True)
                self.viewer.display.Context.UpdateCurrentViewer()

                # print(f"Drag started! Delta: {delta_y:.1f}px")

        if self.is_dragging:
            # Determine operation type based on selection
            has_faces = any(shp.ShapeType() == 4 for shp in self.viewer.selected_shapes)
            has_edges = any(shp.ShapeType() == 6 for shp in self.viewer.selected_shapes)

            if has_faces:
                # Push/pull operation (existing code)
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
                    self.viewer.shape,
                    delta_x,
                    delta_y
                )

                # print(f"Drag: ΔX={delta_x:.1f}px, ΔY={delta_y:.1f}px → Offset={offset:.2f}mm")

                # Only update preview if offset changed significantly (>1mm)
                if (self.last_preview_offset is None or
                    abs(offset - self.last_preview_offset) > 1.0):
                    self.viewer.update_push_pull_preview(offset)
                    self.last_preview_offset = offset

            elif has_edges:
                # Fillet/chamfer operation
                if self.viewer.cached_com is None:
                    return

                # Calculate screen deltas
                current_x = event.position().x()
                current_y = event.position().y()

                # Calculate radius and operation type
                radius, operation_type = calculate_fillet_chamfer_radius(
                    self.display,
                    self.viewer.cached_com,
                    self.drag_start_x,
                    self.drag_start_y,
                    current_x,
                    current_y
                )

                print(f"Fillet/chamfer: radius={radius:.2f}mm, type={operation_type}")

                # Only update preview if radius changed significantly (>0.5mm)
                if (self.last_preview_offset is None or
                    abs(radius - (self.last_preview_offset or 0)) > 0.5):
                    self.viewer.update_fillet_chamfer_preview(radius, operation_type)
                    self.last_preview_offset = radius

            return

        self.original_mouse_move(event)

    def on_mouse_release(self, event):
        """Handle mouse button release"""
        from PyQt6.QtCore import Qt

        if event.button() == Qt.MouseButton.LeftButton:
            if self.is_dragging:
                # Determine operation type based on selection
                has_faces = any(shp.ShapeType() == 4 for shp in self.viewer.selected_shapes)
                has_edges = any(shp.ShapeType() == 6 for shp in self.viewer.selected_shapes)

                if has_faces:
                    # Push/pull finalize (existing code)
                    selected_face = None
                    for shp in self.viewer.selected_shapes:
                        if shp.ShapeType() == 4:  # Face
                            selected_face = shp
                            break

                    if selected_face is not None:
                        current_x = event.position().x()
                        current_y = event.position().y()
                        delta_x = current_x - self.drag_start_x
                        delta_y = current_y - self.drag_start_y

                        offset = calculate_push_pull_offset(
                            self.display,
                            selected_face,
                            self.viewer.shape,
                            delta_x,
                            delta_y
                        )

                        # print(f"✓ Push/pull finished: {offset:.2f}mm")

                        # Finalize the operation
                        self.viewer.finalize_push_pull(offset)

                elif has_edges:
                    # Fillet/chamfer finalize
                    if self.viewer.cached_com is None:
                        return

                    current_x = event.position().x()
                    current_y = event.position().y()

                    # Calculate final radius and operation type
                    radius, operation_type = calculate_fillet_chamfer_radius(
                        self.display,
                        self.viewer.cached_com,
                        self.drag_start_x,
                        self.drag_start_y,
                        current_x,
                        current_y
                    )

                    # print(f"✓ {operation_type} finished: {radius:.2f}mm")

                    # Finalize the operation
                    self.viewer.finalize_fillet_chamfer(radius, operation_type)

            self.is_dragging = False
            self.drag_start_x = None
            self.drag_start_y = None
            self.last_preview_offset = None

        self.original_mouse_release(event)
