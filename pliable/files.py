"""
File import/export operations for Pliable
"""

from OCC.Extend.DataExchange import read_step_file, write_step_file


def import_step(filepath):
    """
    Import a STEP file

    Args:
        filepath: Path to STEP file (.step or .stp)

    Returns:
        TopoDS_Shape: The imported shape, or None if failed
    """
    try:
        print(f"Importing STEP file: {filepath}")
        shape = read_step_file(filepath)

        if shape is None:
            print(f"ERROR: Failed to read STEP file")
            return None

        print(f"✓ Successfully imported: {filepath}")
        return shape

    except Exception as e:
        print(f"ERROR importing STEP file: {e}")
        import traceback
        traceback.print_exc()
        return None


def export_step(shape, filepath):
    """
    Export a shape to STEP file

    Args:
        shape: TopoDS_Shape to export
        filepath: Destination path (.step or .stp)

    Returns:
        bool: True if successful, False otherwise
    """
    try:
        print(f"DEBUG: export_step called")
        print(f"  Shape: {shape}")
        print(f"  Shape type: {type(shape)}")
        print(f"  Filepath: {filepath}")

        if shape is None:
            print("ERROR: Shape is None, cannot export")
            return False

        print(f"Exporting to STEP file: {filepath}")

        # Ensure filepath has .step extension
        if not filepath.lower().endswith(('.step', '.stp')):
            filepath += '.step'

        print(f"  Calling write_step_file...")
        write_step_file(shape, filepath)
        print(f"  write_step_file completed")

        print(f"✓ Successfully exported: {filepath}")
        return True

    except Exception as e:
        print(f"ERROR exporting STEP file: {e}")
        import traceback
        traceback.print_exc()
        return False
