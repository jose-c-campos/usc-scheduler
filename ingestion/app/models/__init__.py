"""
Import all mapped classes **once**, in an order that guarantees every class
referenced by a relationship() is already present in the registry.
"""

from .base import Base          # noqa: F401

# 1) tables referenced by *others* but having no forward refs themselves
from .course   import Course    # noqa: F401
from .professor import Professor  # noqa: F401   ← import *before* RatingSnapshot

# 2) tables that point back to those above
from .rating   import RatingSnapshot  # noqa: F401
from .section  import Section         # noqa: F401
