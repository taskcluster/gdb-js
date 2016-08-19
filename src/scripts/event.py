import sys


def base_event_handler(name, msg):
    """Base handler for custom events."""

    sys.stdout.write('<gdbjs:event:{0} {1} {0}:event:gdbjs>'.format(name, msg))
    sys.stdout.flush()
