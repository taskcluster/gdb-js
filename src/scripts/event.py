import sys


def base_event_handler(name, msg):
    sys.stdout.write('<gdbjs:event:{0} {1} {0}:event:gdbjs>'.format(name, msg))
    sys.stdout.flush()
