"""Stretch: moving a selected part of a solid rigidly while the faces joining it to the rest deform like rubber.

`zones.py` sorts the solid into the protected, rubber and fixed parts; `band.py` finds the direction and the local band the
change is confined to; `falloff.py` and `field.py` are the deformation itself; `fit.py` and `recognize.py` give each changed
face and edge its new geometry; `rebuild.py` puts the same faces, edges and vertices back together around it;
`shorten.py` removes the features a shortening runs over; `frame.py` reads the move, tilt, frame and pivot from the form.
"""
