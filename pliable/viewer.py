"""
3D viewer and interaction handling for Pliable
"""

# Load Qt backend FIRST - import backend module directly
from OCC.Display.backend import load_backend
load_backend("pyqt6")

# NOW we can import qtDisplay
from OCC.Display.qtDisplay import qtViewer3d
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCC.Core.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCC.Core.gp import gp_Vec
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import Qt
import sys


class PliableViewer:
    """Main 3D viewer with face and edge selection"""

    def __init__(self):
        # Create Qt application
        self.app = QApplication.instance()
        if self.app is None:
            self.app = QApplication(sys.argv)

        # Create Qt canvas directly (THIS is the key difference)
        self.canvas = qtViewer3d()
        self.display = self.canvas._display  # Access the underlying OCCT display

        # Create a 100x100x100mm cube
        self.cube = BRepPrimAPI_MakeBox(100, 100, 100).Shape()

        # Display it
        self.ais_shape = self.display.DisplayShape(self.cube, update=True)[0]
        self.display.FitAll()

        # State tracking
        self.selected_shapes = []  # List of all selected shapes
        self.highlighted_ais_objects = []  # List of AIS objects for highlights
        self.preview_shape_ais = None  # Cache for preview display object
        self.original_shape = None

        # Register callbacks
        self.display.register_select_callback(self.on_select)

        # Increase selection sensitivity for easier edge picking
        # Default is typically 2-3 pixels, increase to 5 for better edge detection
        self.display.Context.SetPixelTolerance(5)

        # Enable all selection modes simultaneously using Context.Activate
        # Mode 1 = Vertex, Mode 2 = Edge, Mode 4 = Face
        self.display.Context.Activate(self.ais_shape, 1, True)  # Vertex
        self.display.Context.Activate(self.ais_shape, 2, True)  # Edge
        self.display.Context.Activate(self.ais_shape, 4, True)  # Face

        # Setup keyboard handler for mode switching
        self._hook_keyboard_events()

        # Setup interaction handler - NOW it can access self.canvas!
        from pliable.interaction import InteractionHandler
        self.interaction = InteractionHandler(self)

        print("Pliable v0.1.0")
        print("Controls:")
        print("  - Click: Select face/edge/vertex (cyan)")
        print("  - Ctrl+Click: Add to selection")
        print("  - Shift + Drag on selected face: Push/pull")

    def _hook_keyboard_events(self):
        """Setup keyboard event handler"""
        self.original_key_press = self.canvas.keyPressEvent
        self.canvas.keyPressEvent = self.on_key_press

    def on_key_press(self, event):
        """Handle keyboard events"""
        # Pass to original handler for now
        self.original_key_press(event)

    def on_select(self, selected_shapes, *args):
        """Handle face, edge, or vertex selection with Ctrl+Click multi-select"""
        from PyQt6.QtWidgets import QApplication

        # Check if Ctrl is held
        modifiers = QApplication.keyboardModifiers()
        from PyQt6.QtCore import Qt
        ctrl_held = bool(modifiers & Qt.KeyboardModifier.ControlModifier)

        # Clear preview if exists
        if self.preview_shape_ais is not None:
            self.display.Context.Erase(self.preview_shape_ais, True)
            self.preview_shape_ais = None

        # If not Ctrl, clear all previous selections
        if not ctrl_held:
            for ais_obj in self.highlighted_ais_objects:
                self.display.Context.Erase(ais_obj, True)
            self.highlighted_ais_objects = []
            self.selected_shapes = []

        # Process new selections
        for shp in selected_shapes:
            shape_type = shp.ShapeType()

            # Only process faces, edges, and vertices
            if shape_type not in [4, 6, 7]:  # Face, Edge, Vertex
                continue

            # Add to selection list
            self.selected_shapes.append(shp)

            # Store original shape reference if first selection
            if len(self.selected_shapes) == 1:
                self.original_shape = self.cube

            # Determine shape name for printing
            if shape_type == 4:
                shape_name = "Face"
            elif shape_type == 6:
                shape_name = "Edge"
            elif shape_type == 7:
                shape_name = "Vertex"
            else:
                shape_name = "Unknown"

            print(f"{shape_name} selected!")

            # Create highlight
            ais_obj = self.display.DisplayShape(
                shp,
                color=Quantity_Color(0, 1, 1, Quantity_TOC_RGB),  # Cyan for all
                update=False
            )[0]

            self.highlighted_ais_objects.append(ais_obj)

        # Update display once at the end
        self.display.Context.UpdateCurrentViewer()

    def update_push_pull_preview(self, offset):
        """Update lightweight preview during drag"""
        # Find the selected face (push/pull only works on faces)
        selected_face = None
        for shp in self.selected_shapes:
            if shp.ShapeType() == 4:  # Face
                selected_face = shp
                break

        if selected_face is None:
            return

        from pliable.geometry import get_face_center_and_normal
        from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakePrism

        # Get face normal
        center, normal = get_face_center_and_normal(selected_face, self.cube)

        # Create offset vector
        offset_vec = gp_Vec(
            normal.X() * offset,
            normal.Y() * offset,
            normal.Z() * offset
        )

        # Create simple preview prism
        prism_builder = BRepPrimAPI_MakePrism(selected_face, offset_vec)

        if prism_builder.IsDone():
            preview_prism = prism_builder.Shape()

            # Erase old preview WITHOUT triggering full redraw
            if self.preview_shape_ais is not None:
                self.display.Context.Erase(self.preview_shape_ais, False)  # ← False = don't update yet

            # Display new preview
            self.preview_shape_ais = self.display.DisplayShape(
                preview_prism,
                color=Quantity_Color(1, 1, 0, Quantity_TOC_RGB),  # Yellow
                transparency=0.5,
                update=False  # ← False = don't update yet
            )[0]

            # Single update at the end
            self.display.Context.UpdateCurrentViewer()  # ← Only ONE update per call

    def finalize_push_pull(self, offset):
        """Finalize push/pull operation - do the real Boolean here"""
        # Find the selected face (push/pull only works on faces)
        selected_face = None
        for shp in self.selected_shapes:
            if shp.ShapeType() == 4:  # Face
                selected_face = shp
                break

        if selected_face is None:
            print("ERROR: No face selected for push/pull")
            return

        from pliable.geometry import offset_face

        print("Computing final geometry...")

        # CRITICAL: Clear ALL display objects first
        if self.preview_shape_ais is not None:
            self.display.Context.Remove(self.preview_shape_ais, True)
            self.preview_shape_ais = None

        for ais_obj in self.highlighted_ais_objects:
            self.display.Context.Remove(ais_obj, True)
        self.highlighted_ais_objects = []

        if self.ais_shape is not None:
            self.display.Context.Remove(self.ais_shape, True)
            self.ais_shape = None

        # Clear all selection state
        self.display.Context.ClearSelected(True)

        # Use the ORIGINAL shape that was current when face was selected
        if hasattr(self, 'original_shape') and self.original_shape is not None:
            shape_to_modify = self.original_shape
        else:
            shape_to_modify = self.cube

        # Apply the offset with Boolean operation
        try:
            new_shape = offset_face(shape_to_modify, selected_face, offset)

            if new_shape is not None:
                self.cube = new_shape
                print(f"✓ Shape updated! Push/pull of {offset:.2f}mm applied.")
            else:
                print("ERROR: offset_face returned None")
                return
        except Exception as e:
            print(f"ERROR during push/pull: {e}")
            import traceback
            traceback.print_exc()
            return

        # Clear ALL selection state
        self.selected_shapes = []
        self.original_shape = None

        # Complete context reset
        self.display.Context.RemoveAll(True)

        # Display ONLY the new shape
        self.ais_shape = self.display.DisplayShape(self.cube, update=True)[0]

        # CRITICAL: Re-enable all selection modes
        self.display.Context.Activate(self.ais_shape, 1, True)  # Vertex
        self.display.Context.Activate(self.ais_shape, 2, True)  # Edge
        self.display.Context.Activate(self.ais_shape, 4, True)  # Face

        self.display.FitAll()
        self.display.Repaint()

        print("Select a face, edge, or vertex to continue editing.")

    def _set_parent_window(self, window):
        """Called by window after construction"""
        self.parent_window = window

    def load_shape(self, shape):
        """
        Load a new shape into the viewer

        Args:
            shape: TopoDS_Shape to display
        """
        try:
            print("Loading shape into viewer...")

            # Replace current shape
            self.cube = shape

            # Clear all display
            if self.ais_shape is not None:
                self.display.Context.Remove(self.ais_shape, True)

            self.display.Context.RemoveAll(True)

            # Clear selection state
            self.selected_shapes = []
            self.highlighted_ais_objects = []
            self.original_shape = None
            self.preview_shape_ais = None

            # Display new shape
            self.ais_shape = self.display.DisplayShape(shape, update=True)[0]

            # Re-enable all selection modes
            self.display.Context.Activate(self.ais_shape, 1, True)  # Vertex
            self.display.Context.Activate(self.ais_shape, 2, True)  # Edge
            self.display.Context.Activate(self.ais_shape, 4, True)  # Face

            self.display.FitAll()
            self.display.Repaint()

            print("✓ Shape loaded and ready for editing!")

        except Exception as e:
            print(f"ERROR loading shape: {e}")
            import traceback
            traceback.print_exc()
