#!/usr/bin/env python
"""
Pliable - Direct BREP modeler
Main entry point
"""

from pliable.viewer import PliableViewer


def main():
    """Launch Pliable viewer"""
    viewer = PliableViewer()
    viewer.run()


if __name__ == "__main__":
    main()
