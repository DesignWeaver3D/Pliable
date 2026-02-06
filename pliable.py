#!/usr/bin/env python
"""
Pliable - Direct BREP modeler
Main entry point
"""

from PyQt6.QtWidgets import QApplication
import sys


def main():
    """Launch Pliable application"""
    # Create Qt application
    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)

    # Create and show main window
    from pliable.window import PliableWindow
    window = PliableWindow()
    window.show()

    # Run event loop
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
