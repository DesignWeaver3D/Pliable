"""
Main application window for Pliable
"""

from PyQt6.QtWidgets import QMainWindow, QFileDialog, QMessageBox
from PyQt6.QtGui import QAction, QKeySequence
from pliable.viewer import PliableViewer
from pliable.files import import_step, export_step


class PliableWindow(QMainWindow):
    """Main application window with menus and 3D viewer"""

    def __init__(self):
        super().__init__()

        # Window setup
        self.setWindowTitle("Pliable - Direct BREP Modeler")
        self.setGeometry(100, 100, 1024, 768)

        # Create viewer as central widget
        self.viewer = PliableViewer()
        self.setCentralWidget(self.viewer.canvas)

        # Initialize viewer's overlay after window is shown
        self.viewer._set_parent_window(self)

        # Setup menus
        self._create_menus()

        # Setup keyboard shortcuts
        self._create_shortcuts()

        print("\nPliable v0.1.0")
        print("File menu: File → Open, Save As")
        print("Shortcuts: Ctrl+O (Open), Ctrl+S (Save)")
        print("\nControls:")
        print("  - Click: Select face/edge/vertex (cyan)")
        print("  - Ctrl+Click: Add to selection")
        print("  - Shift + Drag on selected face: Push/pull")

    def _create_menus(self):
        """Create menu bar"""
        menubar = self.menuBar()

        # File menu
        file_menu = menubar.addMenu("&File")

        # Open action
        open_action = QAction("&Open...", self)
        open_action.setShortcut(QKeySequence.StandardKey.Open)
        open_action.setStatusTip("Open a STEP file")
        open_action.triggered.connect(self.open_file)
        file_menu.addAction(open_action)

        # Save As action
        save_action = QAction("&Save As...", self)
        save_action.setShortcut(QKeySequence.StandardKey.SaveAs)
        save_action.setStatusTip("Export to STEP file")
        save_action.triggered.connect(self.save_file)
        file_menu.addAction(save_action)

        file_menu.addSeparator()

        # Exit action
        exit_action = QAction("E&xit", self)
        exit_action.setShortcut(QKeySequence.StandardKey.Quit)
        exit_action.setStatusTip("Exit application")
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)

    def _create_shortcuts(self):
        """Create additional keyboard shortcuts"""
        # Shortcuts are already defined in menu actions
        pass

    def open_file(self):
        """Open a STEP file"""
        filename, _ = QFileDialog.getOpenFileName(
            self,
            "Open STEP File",
            "",
            "STEP Files (*.step *.stp);;All Files (*.*)"
        )

        if filename:
            shape = import_step(filename)

            if shape is not None:
                self.viewer.load_shape(shape)
            else:
                QMessageBox.critical(
                    self,
                    "Import Error",
                    f"Failed to import:\n{filename}"
                )

    def save_file(self):
        """Save current shape to STEP file"""
        if self.viewer.cube is None:
            QMessageBox.warning(
                self,
                "Nothing to Save",
                "No geometry to export."
            )
            return

        filename, _ = QFileDialog.getSaveFileName(
            self,
            "Save STEP File",
            "untitled.step",
            "STEP Files (*.step *.stp);;All Files (*.*)"
        )

        if filename:
            success = export_step(self.viewer.cube, filename)

            if success:
                QMessageBox.information(
                    self,
                    "Export Successful",
                    f"Saved to:\n{filename}"
                )
            else:
                QMessageBox.critical(
                    self,
                    "Export Error",
                    f"Failed to export:\n{filename}"
                )
