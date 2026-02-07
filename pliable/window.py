"""
Main application window for Pliable
"""

from PyQt6.QtWidgets import QMainWindow, QFileDialog, QMessageBox, QTextEdit, QDockWidget
from PyQt6.QtGui import QAction, QKeySequence
from PyQt6.QtCore import Qt
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

        # Setup status bar with message history
        self._create_status_bar()

        # Setup menus
        self._create_menus()

        # Setup keyboard shortcuts
        self._create_shortcuts()

        # Initial status message
        self.show_status_message("Ready")

        print("\nPliable v0.1.0")
        print("File menu: File → Open, Save As")
        print("Shortcuts: Ctrl+O (Open), Ctrl+S (Save)")
        print("\nControls:")
        print("  - Click: Select face/edge/vertex (cyan)")
        print("  - Ctrl+Click: Add to selection")
        print("  - Shift + Drag on selected face: Push/pull")

    def _create_status_bar(self):
        """Create status bar with scrollable message history"""
        # Create a dock widget for message history
        self.message_dock = QDockWidget("Messages", self)
        self.message_dock.setAllowedAreas(Qt.DockWidgetArea.BottomDockWidgetArea)

        # Create text widget for messages
        self.message_history = QTextEdit()
        self.message_history.setReadOnly(True)
        self.message_history.setMaximumHeight(100)  # Limit height

        self.message_dock.setWidget(self.message_history)
        self.addDockWidget(Qt.DockWidgetArea.BottomDockWidgetArea, self.message_dock)

        # Hide by default, can be shown via View menu later if needed
        self.message_dock.hide()

        # Message counter
        self.message_count = 0
        self.max_messages = 100

        # Also create traditional status bar for current message
        self.status_bar = self.statusBar()

    def show_status_message(self, message):
        """
        Display a message in the status bar and add to history

        Args:
            message: String message to display
        """
        # Show in status bar
        self.status_bar.showMessage(message)

        # Add to message history
        self.message_count += 1
        self.message_history.append(f"[{self.message_count}] {message}")

        # Limit to max messages
        if self.message_count > self.max_messages:
            # Clear old messages by getting all text and keeping last N
            text = self.message_history.toPlainText()
            lines = text.split('\n')
            if len(lines) > self.max_messages:
                # Keep last max_messages lines
                self.message_history.clear()
                self.message_history.setText('\n'.join(lines[-self.max_messages:]))
                self.message_count = self.max_messages

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

        # Edit menu
        edit_menu = menubar.addMenu("&Edit")

        # Undo action
        undo_action = QAction("&Undo", self)
        undo_action.setShortcut(QKeySequence.StandardKey.Undo)  # Ctrl+Z
        undo_action.setStatusTip("Undo last operation")
        undo_action.triggered.connect(self.undo)
        edit_menu.addAction(undo_action)

        # Redo action
        redo_action = QAction("&Redo", self)
        redo_action.setShortcut(QKeySequence("Ctrl+Shift+Z"))  # Explicit Ctrl+Shift+Z
        redo_action.setStatusTip("Redo last undone operation")
        redo_action.triggered.connect(self.redo)
        edit_menu.addAction(redo_action)

        # View menu
        view_menu = menubar.addMenu("&View")

        # Toggle message history action
        self.toggle_messages_action = QAction("Show &Messages", self)
        self.toggle_messages_action.setCheckable(True)
        self.toggle_messages_action.setChecked(False)  # Hidden by default
        self.toggle_messages_action.setStatusTip("Show/hide message history panel")
        self.toggle_messages_action.triggered.connect(self.toggle_message_history)
        view_menu.addAction(self.toggle_messages_action)

    def _create_shortcuts(self):
        """Create additional keyboard shortcuts"""
        # Shortcuts are already defined in menu actions
        pass

    def toggle_message_history(self):
        """Toggle visibility of message history panel"""
        if self.message_dock.isVisible():
            self.message_dock.hide()
            self.toggle_messages_action.setText("Show &Messages")
        else:
            self.message_dock.show()
            self.toggle_messages_action.setText("Hide &Messages")

    def undo(self):
        """Undo last operation"""
        self.viewer.undo()

    def redo(self):
        """Redo last undone operation"""
        self.viewer.redo()

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
        if self.viewer.document.shape is None:
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
            success = export_step(self.viewer.document.shape, filename)

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
