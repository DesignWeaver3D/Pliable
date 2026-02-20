"""
Geometry calculations and operations for Pliable
"""

from OCC.Core.BRepGProp import brepgprop
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.gp import gp_Pnt, gp_Vec
from OCC.Core.GeomLProp import GeomLProp_SLProps


def get_center_of_mass(shape):
    """
    Get the center of mass of a solid or shape

    Args:
        shape: TopoDS_Shape (solid, shell, compound, etc.)

    Returns:
        gp_Pnt: Center of mass point, or None if calculation fails
    """
    try:
        props = GProp_GProps()
        brepgprop.VolumeProperties(shape, props)
        com = props.CentreOfMass()
        # print(f"Center of mass: ({com.X():.2f}, {com.Y():.2f}, {com.Z():.2f})")
        return com
    except Exception as e:
        print(f"ERROR: Could not compute center of mass: {e}")
        return None


def get_face_center_and_normal(face, solid=None):
    """
    Get the center point and normal vector of a face

    Args:
        face: TopoDS_Face
        solid: TopoDS_Solid (optional) - if provided, ensures normal points outward

    Returns:
        tuple: (center_point, normal_vector)
            center_point: gp_Pnt - the centroid of the face
            normal_vector: gp_Vec - the normal vector (unit length, pointing outward)
    """
    from OCC.Core.TopAbs import TopAbs_REVERSED

    # Get face center using surface properties
    surface = BRepAdaptor_Surface(face)

    # Get UV bounds
    u_min = surface.FirstUParameter()
    u_max = surface.LastUParameter()
    v_min = surface.FirstVParameter()
    v_max = surface.LastVParameter()

    # Center in UV space
    u_mid = (u_min + u_max) / 2.0
    v_mid = (v_min + v_max) / 2.0

    # Get point and normal at center
    props = GeomLProp_SLProps(surface.Surface().Surface(), u_mid, v_mid, 1, 1e-6)

    if props.IsNormalDefined():
        center = props.Value()
        normal_dir = props.Normal()  # This is a gp_Dir

        # Convert gp_Dir to gp_Vec
        normal = gp_Vec(normal_dir.X(), normal_dir.Y(), normal_dir.Z())

        # Check face orientation and flip if needed
        if face.Orientation() == TopAbs_REVERSED:
            normal.Reverse()
            # print("DEBUG: Face is REVERSED, flipping normal")

        return center, normal
    else:
        # Fallback: use mass properties for center
        props_mass = GProp_GProps()
        brepgprop.SurfaceProperties(face, props_mass)
        center = props_mass.CentreOfMass()

        # Return a default normal
        return center, gp_Vec(0, 0, 1)


def screen_to_world_direction(display, screen_x, screen_y, depth_point):
    """
    Convert screen coordinates to a 3D world-space direction

    Args:
        display: OCC display object
        screen_x, screen_y: Screen coordinates in pixels
        depth_point: gp_Pnt - reference point for depth calculation

    Returns:
        gp_Vec: Unit vector in world space corresponding to screen movement
    """
    view = display.View

    # Convert screen point to 3D ray
    # OCCT's Convert methods give us the ray from camera through the screen point
    x_world, y_world, z_world = view.Convert(int(screen_x), int(screen_y))

    return gp_Vec(x_world, y_world, z_world)


def calculate_push_pull_offset(display, face, solid, screen_delta_x, screen_delta_y):
    """
    Calculate the 3D offset for push/pull based on screen drag

    Args:
        display: OCC display object
        face: TopoDS_Face being modified
        solid: TopoDS_Solid that the face belongs to
        screen_delta_x: Horizontal screen movement in pixels
        screen_delta_y: Vertical screen movement in pixels

    Returns:
        float: Distance to offset the face along its normal
    """
    # Get face geometry with correct outward normal
    center, normal = get_face_center_and_normal(face, solid)  # ← Pass solid here

    # Get view parameters
    view = display.View

    # Calculate screen-to-world scale at the face's depth
    scale = view.Scale()

    # Get camera position
    camera = view.Camera()
    cam_pos = gp_Pnt(camera.Eye().X(), camera.Eye().Y(), camera.Eye().Z())

    # Distance from camera to face center
    distance_to_face = cam_pos.Distance(center)

    # Screen height in pixels
    screen_height = display.View.Window().Size()[1]

    # Estimate the view height at the face's distance
    view_height_at_depth = screen_height / scale

    # Calculate mm per pixel
    mm_per_pixel = view_height_at_depth / screen_height

    # Convert screen delta to world-space delta
    world_delta_x = screen_delta_x * mm_per_pixel
    world_delta_y = screen_delta_y * mm_per_pixel

    # Get camera's right and up vectors
    up = gp_Vec(camera.Up().X(), camera.Up().Y(), camera.Up().Z())
    up.Normalize()

    direction = gp_Vec(camera.Direction().X(), camera.Direction().Y(), camera.Direction().Z())
    direction.Normalize()

    # Right vector is cross product of direction and up
    right = direction.Crossed(up)
    right.Normalize()

    # Combine screen deltas into a 3D camera-space vector
    camera_space_delta = gp_Vec(
        right.X() * world_delta_x - up.X() * world_delta_y,
        right.Y() * world_delta_x - up.Y() * world_delta_y,
        right.Z() * world_delta_x - up.Z() * world_delta_y
    )

    # Check if face normal points toward or away from camera
    face_to_cam = gp_Vec(
        cam_pos.X() - center.X(),
        cam_pos.Y() - center.Y(),
        cam_pos.Z() - center.Z()
    )
    face_to_cam.Normalize()

    # Dot product tells us orientation
    facing_camera = normal.Dot(face_to_cam)

    # Project camera movement onto face normal
    offset = camera_space_delta.Dot(normal)

    # If face is pointing away from camera, flip the offset
    if facing_camera < 0:
        offset = -offset

    return offset

def calculate_fillet_chamfer_radius(display, com_point, drag_start_x, drag_start_y, current_x, current_y):
    """
    Calculate fillet/chamfer radius and determine operation type based on cursor movement
    relative to center of mass on screen

    Args:
        display: OCC display object
        com_point: gp_Pnt - center of mass of the solid
        drag_start_x, drag_start_y: Initial cursor position in pixels
        current_x, current_y: Current cursor position in pixels

    Returns:
        tuple: (radius, operation_type)
            radius: float - radius/distance for operation in mm
            operation_type: str - "fillet" or "chamfer"
    """
    import math

    # Project COM to screen coordinates
    view = display.View
    com_screen_x, com_screen_y = view.Convert(com_point.X(), com_point.Y(), com_point.Z())

    # Calculate initial distance from cursor to COM on screen
    dist_start = math.sqrt(
        (drag_start_x - com_screen_x)**2 +
        (drag_start_y - com_screen_y)**2
    )

    # Calculate current distance from cursor to COM on screen
    dist_current = math.sqrt(
        (current_x - com_screen_x)**2 +
        (current_y - com_screen_y)**2
    )

    # Determine operation type
    if dist_current > dist_start:
        operation_type = "fillet"  # Moving away from COM
    else:
        operation_type = "chamfer"  # Moving toward COM

    # Calculate radius based on distance change
    distance_change_pixels = abs(dist_current - dist_start)

    # Convert to mm using same scale calculation as push/pull
    scale = view.Scale()
    screen_height = display.View.Window().Size()[1]
    view_height_at_depth = screen_height / scale
    mm_per_pixel = view_height_at_depth / screen_height

    radius = distance_change_pixels * mm_per_pixel

    return radius, operation_type

def offset_face(solid, face, distance):
    """
    Offset a face of a solid by a given distance along its normal
    """
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakePrism
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
    from OCC.Core.ShapeUpgrade import ShapeUpgrade_UnifySameDomain

    print(f"  offset_face: solid={solid}, face={face}, distance={distance:.2f}")

    # Validation
    if solid is None or face is None:
        # print("ERROR: Invalid input to offset_face")
        return solid

    if abs(distance) < 0.01:  # Less than 0.01mm, ignore
        # print("Offset too small, ignoring")
        return solid

    try:
        print(f"  Getting face normal...")
        # Get face normal and center
        center, normal = get_face_center_and_normal(face)

        print(f"  Creating offset vector...")
        # Create offset vector
        offset_vec = gp_Vec(
            normal.X() * distance,
            normal.Y() * distance,
            normal.Z() * distance
        )

        print(f"  Creating prism...")
        # Create prism from the face
        prism_builder = BRepPrimAPI_MakePrism(face, offset_vec)
        prism_builder.Build()

        if not prism_builder.IsDone():
            # print("ERROR: Failed to create prism")
            return solid

        prism = prism_builder.Shape()

        print(f"  Performing Boolean operation ({('Fuse' if distance > 0 else 'Cut')})...")
        # Boolean operation
        if distance > 0:
            bool_op = BRepAlgoAPI_Fuse(solid, prism)
        else:
            bool_op = BRepAlgoAPI_Cut(solid, prism)

        bool_op.Build()
        print(f"  Boolean operation complete")

        if not bool_op.IsDone():
            # print("ERROR: Boolean operation failed")
            return solid

        result = bool_op.Shape()

        if result.IsNull():
            # print("ERROR: Boolean returned null shape")
            return solid

        print(f"  Refining geometry...")
        # Refine the result with timeout protection
        # OCCT refinement can hang on complex geometry, especially after fillets
        import threading

        refined_result = [None]  # Use list to share result between threads
        exception_holder = [None]

        def refine_with_timeout():
            try:
                refiner = ShapeUpgrade_UnifySameDomain(result, True, True, True)
                refiner.Build()
                refined_result[0] = refiner.Shape()
            except Exception as e:
                exception_holder[0] = e

        # Start refinement in separate thread
        refine_thread = threading.Thread(target=refine_with_timeout)
        refine_thread.daemon = True  # Daemon thread will be killed if main program exits
        refine_thread.start()

        # Wait up to 5 seconds
        refine_thread.join(timeout=5.0)

        if refine_thread.is_alive():
            # Timeout occurred - thread is still running
            print(f"  WARNING: Refinement timeout (>5s), using unrefined result")
            # Note: We can't actually kill the thread, but we return and let it finish in background
            return result

        if exception_holder[0] is not None:
            print(f"  WARNING: Refinement error ({exception_holder[0]}), using unrefined result")
            return result

        if refined_result[0] is None or refined_result[0].IsNull():
            print(f"  WARNING: Refinement produced null shape, using unrefined result")
            return result

        print(f"  Refinement complete, returning result")
        return refined_result[0]

    except Exception as e:
        # print(f"ERROR in offset_face: {e}")
        print(f"  EXCEPTION in offset_face: {e}")
        import traceback
        traceback.print_exc()
        return solid
