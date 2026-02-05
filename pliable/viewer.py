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
import sys


class PliableViewer:
    """Main 3D viewer with face selection and interaction"""

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
        self.selected_face = None
        self.preview_shape_ais = None  # Cache for preview display object
        self.original_shape = None
        self.highlighted_face_ais = None

        # Register callbacks
        self.display.register_select_callback(self.on_select)

        # Enable face selection mode
        self.display.SetSelectionModeFace()

        # Setup interaction handler - NOW it can access self.canvas!
        from pliable.interaction import InteractionHandler
        self.interaction = InteractionHandler(self)

        print("Pliable v0.1.0")
        print("Controls:")
        print("  - Click on face: Select it (turns cyan)")
        print("  - Shift + Drag on selected face: Push/pull")

    def on_select(self, selected_shapes, *args):
        """Handle face selection"""
        # Clear any existing preview first
        if self.preview_shape_ais is not None:
            self.display.Context.Erase(self.preview_shape_ais, True)
            self.preview_shape_ais = None

        # Clear any existing face highlight
        if self.highlighted_face_ais is not None:
            self.display.Context.Erase(self.highlighted_face_ais, True)
            self.highlighted_face_ais = None

        for shp in selected_shapes:
            if shp.ShapeType() == 4:  # Face
                # Store the face AND its parent solid reference
                self.selected_face = shp
                self.original_shape = self.cube  # Store shape at selection time
                print("Face selected!")

                # Highlight selected face in cyan
                self.display.SetSelectionModeVertex()
                self.display.EraseAll()
                self.display.DisplayShape(self.cube, update=False)

                # Store the highlight AIS object so we can erase it later
                self.highlighted_face_ais = self.display.DisplayShape(
                    shp,
                    color=Quantity_Color(0, 1, 1, Quantity_TOC_RGB),
                    update=True
                )[0]  # ← Store the AIS object

                self.display.SetSelectionModeFace()

    def update_push_pull_preview(self, offset):
        """Update lightweight preview during drag"""
        if self.selected_face is None:
            return

        from pliable.geometry import get_face_center_and_normal
        from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakePrism

        # Get face normal
        center, normal = get_face_center_and_normal(self.selected_face, self.cube)

        # Create offset vector
        offset_vec = gp_Vec(
            normal.X() * offset,
            normal.Y() * offset,
            normal.Z() * offset
        )

        # Create simple preview prism
        prism_builder = BRepPrimAPI_MakePrism(self.selected_face, offset_vec)

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
        if self.selected_face is None:
            return

        from pliable.geometry import offset_face

        print("Computing final geometry...")

        # CRITICAL: Clear ALL display objects first
        if self.preview_shape_ais is not None:
            self.display.Context.Remove(self.preview_shape_ais, True)
            self.preview_shape_ais = None

        if self.highlighted_face_ais is not None:
            self.display.Context.Remove(self.highlighted_face_ais, True)
            self.highlighted_face_ais = None

        if self.ais_shape is not None:
            self.display.Context.Remove(self.ais_shape, True)
            self.ais_shape = None

        # Clear all selection state
        self.display.Context.ClearSelected(True)

        # Use the ORIGINAL shape that was current when face was selected
        if hasattr(self, 'original_shape'):
            shape_to_modify = self.original_shape
        else:
            shape_to_modify = self.cube

        # Apply the offset with Boolean operation
        try:
            new_shape = offset_face(shape_to_modify, self.selected_face, offset)

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
        self.selected_face = None
        self.original_shape = None

        # Complete context reset
        self.display.Context.RemoveAll(True)

        # Display ONLY the new shape
        self.ais_shape = self.display.DisplayShape(self.cube, update=True)[0]

        # CRITICAL: Re-enable face selection mode
        self.display.SetSelectionModeFace()  # ← ADD THIS

        self.display.FitAll()
        self.display.Repaint()

        print("Select a face to continue editing.")

    def run(self):
        """Start the viewer event loop"""
        self.canvas.show()
        sys.exit(self.app.exec())
