import json

frame = gdb.selected_frame()
block = frame.block()
variables = []

while block:
    for symbol in block:
        if (symbol.is_argument or symbol.is_variable):
            scope = 'global' if block.is_global else 'static' if \
                block.is_static else 'arg' if symbol.is_argument else 'local'

            variables.append({
                'name': symbol.name,
                'value': str(symbol.value(frame)),
                'type': str(symbol.type),
                'scope': scope
            })

    block = block.superblock

print(json.dumps(variables))

